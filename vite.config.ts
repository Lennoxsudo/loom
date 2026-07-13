import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vite 插件：确保 Monaco Editor 语法高亮在 Tauri 生产构建中正常工作。
 *
 * 根因分析：
 * Monaco v0.55.1 的每个语言贡献文件使用 loader: () => import('./rust.js') 懒加载
 * tokenizer。在 Tauri 生产环境（http://tauri.localhost/）中，即使将动态 import()
 * 转换为静态 import + Promise.resolve()，Monaco 内部的 LazyLanguageLoader +
 * registerTokensProviderFactory + onLanguageEncountered 懒激活链路仍然无法正确触发
 * tokenization，导致所有代码只呈现白色。
 *
 * 解决方案：
 * 1. 将动态 import() 转换为静态 import + Promise.resolve()，消除 chunk 加载依赖
 * 2. 在每个 basic-languages 贡献文件末尾，直接调用 languages.setMonarchTokensProvider()
 *    和 languages.setLanguageConfiguration()，在模块求值时立即注册 tokenizer，
 *    完全绕过 Monaco 的 LazyLanguageLoader 懒加载机制
 *
 * setMonarchTokensProvider 优先级高于 registerTokensProviderFactory，
 * 因此直接注册后即使 lazy loader 未正确触发也不影响语法高亮。
 */
function monacoStaticImports(): Plugin {
  return {
    name: 'monaco-static-imports',
    enforce: 'pre',
    transform(code, id) {
      const isBasicLang =
        id.includes('monaco-editor/esm/vs/basic-languages') &&
        id.endsWith('.contribution.js') &&
        !id.includes('_.contribution.js');
      const isRichLang =
        id.includes('monaco-editor/esm/vs/language/') && id.endsWith('monaco.contribution.js');

      if (!isBasicLang && !isRichLang) return null;

      // 查找所有相对路径的动态 import() 调用：import('./xxx.js')
      const importRegex = /import\(\s*['"]\.\/([^'"]+\.js)['"]\s*\)/g;
      let match: RegExpExecArray | null;
      const staticImports = new Map<string, string>();
      const replacements: { from: string; to: string }[] = [];
      let counter = 0;

      while ((match = importRegex.exec(code)) !== null) {
        const fileName = match[1];
        const fullMatch = match[0];
        let varName = staticImports.get(fileName);
        if (!varName) {
          varName = `__monaco_lang_${counter++}`;
          staticImports.set(fileName, varName);
        }
        replacements.push({
          from: fullMatch,
          to: `Promise.resolve(${varName})`,
        });
      }

      if (staticImports.size === 0) return null;

      // 在文件顶部添加静态 import 声明
      const staticImportLines = [...staticImports.entries()]
        .map(([fileName, varName]) => `import * as ${varName} from './${fileName}';`)
        .join('\n');

      let newCode = staticImportLines + '\n' + code;
      // 替换动态 import() 为 Promise.resolve()
      for (const { from, to } of replacements) {
        newCode = newCode.replace(from, to);
      }

      // 仅对 basic-languages 贡献文件添加即时 tokenizer 注册，
      // 绕过在 Tauri 生产环境中失效的 LazyLanguageLoader 懒加载机制。
      // rich language（json/css/html/typescript）的语法高亮由对应的 basic-languages 提供，
      // 不需要此处理。
      // freemarker2 等非标准贡献文件使用 .then() 链式加载，无法简单提取 conf/language，
      // 跳过即时注册（它们仍通过 Promise.resolve() loader 机制工作）。
      if (isBasicLang) {
        const langIdMatch = newCode.match(/registerLanguage\(\{[^}]*?id:\s*["']([^"']+)["']/);
        // 检测标准 loader 模式，支持两种写法：
        //   1. loader: () => import('./xxx.js')           — 箭头直接返回
        //   2. loader: () => { return import('./xxx.js') } — block-body（如 typescript）
        // 如果 loader 使用 .then() 链（如 freemarker2），则跳过即时注册
        const hasSimpleLoader = /loader:\s*\(\)\s*=>\s*(?:import\(|\{\s*return\s+import\()/.test(
          code
        );
        if (langIdMatch && hasSimpleLoader) {
          const langId = langIdMatch[1];
          const modVarName = [...staticImports.values()][0];
          // 使用 monaco-editor 包级导入，比 ../../editor/editor.api2.js 相对路径更稳定
          // Vite 对包级导入的模块解析更可靠，不会因内部文件结构调整而失效
          const eagerSetup = [
            `import { languages as __monaco_languages } from 'monaco-editor';`,
            `if (${modVarName}.language) {`,
            `  __monaco_languages.setMonarchTokensProvider("${langId}", ${modVarName}.language);`,
            `}`,
            `if (${modVarName}.conf) {`,
            `  __monaco_languages.setLanguageConfiguration("${langId}", ${modVarName}.conf);`,
            `}`,
          ].join('\n');
          newCode += '\n' + eagerSetup;
        }
      }

      return { code: newCode, map: null };
    },
  };
}

/**
 * Vite 插件：修复 WebView2 生产环境中 Monaco Editor CSS 注入失败的问题。
 *
 * 根因：WebView2 在 tauri.localhost 协议下，设置 <style>.textContent 后
 * 不会将其解析为 CSSOM 规则（sheet.cssRules.length 始终为 0）。
 * 即使删除旧 <style> 后新建元素设置 textContent 也不生效。
 * 唯一可行方案是 document.adoptedStyleSheets + CSSStyleSheet.replaceSync()。
 *
 * 级联优先级问题：
 * adoptedStyleSheets 中的规则优先级高于 <style> 元素中的规则。
 * 直接注入会覆盖 Monaco 的动态样式（行号颜色、选区高亮、光标等），
 * 导致"鼠标选中某行，该行行号消失"等问题。
 *
 * 解决方案：
 * 将 CSS 包裹在 @layer monaco-colors { ... } 中，使规则具有较低的级联优先级。
 * CSS @layer 中的规则优先级低于未分层的规则，因此 Monaco 通过 <style> 元素
 * 或 insertRule() 注入的动态样式可以正确覆盖 @layer 中的默认主题色。
 *
 * 检测逻辑：
 * 先正常设置 textContent（正常浏览器没问题），然后检查 sheet.cssRules.length。
 * 如果为 0，说明 WebView2 bug 存在，启用 adoptedStyleSheets + @layer 回退。
 * 正常浏览器不会触发回退，也不会残留 adoptedStyleSheets。
 *
 * 匹配策略：
 * 使用正则匹配而非精确字符串匹配，即使 Monaco 内部代码有微小格式变化也能正确定位。
 */
function monacoWebView2CSSFix(): Plugin {
  return {
    name: 'monaco-webview2-css-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('monaco-editor/esm/vs/editor/standalone/browser/standaloneThemeService'))
        return null;

      let result = code;

      // 1. Replace _updateCSS: add __wv2Fix() call and insert __wv2Fix method
      // Use regex to match the method body robustly (handles minor format changes)
      const updateCSSPattern = /_updateCSS\(\)\s*\{[\s\S]*?this\._allCSS\s*=\s*`\$\{this\._codiconCSS\}[\s\S]*?\$\{this\._themeCSS\}`[\s\S]*?this\._styleElements\.forEach\([^)]+\)[\s\S]*?\}/;

      const newUpdateCSS = `_updateCSS() {
        this._allCSS = \`\${this._codiconCSS}\\n\${this._themeCSS}\`;
        this._styleElements.forEach(styleElement => styleElement.textContent = this._allCSS);
        this.__wv2Fix();
    }
    __wv2Fix() {
        try {
            const needsFix = this._styleElements?.length > 0 &&
                (!this._styleElements[0]?.sheet || this._styleElements[0].sheet.cssRules.length === 0);
            if (needsFix && typeof CSSStyleSheet !== 'undefined' && CSSStyleSheet.prototype.replaceSync) {
                const sheet = new CSSStyleSheet();
                sheet.replaceSync('@layer monaco-colors {' + this._allCSS + '}');
                sheet.__monacoFix = true;
                const arr = [...document.adoptedStyleSheets];
                document.adoptedStyleSheets = [...arr.filter(s => !s.__monacoFix), sheet];
            } else if (!needsFix) {
                const arr = [...document.adoptedStyleSheets];
                const filtered = arr.filter(s => !s.__monacoFix);
                if (filtered.length !== arr.length) {
                    document.adoptedStyleSheets = filtered;
                }
            }
        } catch {}
    }`;

      if (updateCSSPattern.test(result)) {
        result = result.replace(updateCSSPattern, newUpdateCSS);
      } else {
        // Fallback: try exact string match (for older Monaco versions)
        const oldUpdateCSS = `_updateCSS() {
        this._allCSS = \`\${this._codiconCSS}\\n\${this._themeCSS}\`;
        this._styleElements.forEach(styleElement => styleElement.textContent = this._allCSS);
    }`;
        if (result.includes(oldUpdateCSS)) {
          result = result.replace(oldUpdateCSS, newUpdateCSS);
        } else {
          console.warn('[monaco-webview2-css-fix] Could not find _updateCSS method to patch');
          return null;
        }
      }

      // 2. Add __wv2Fix() call in _registerRegularEditorContainer after pushing style element.
      // Use regex to match the method body robustly
      const registerPattern = /_registerRegularEditorContainer\(\)\s*\{[\s\S]*?this\._globalStyleElement\s*=\s*createStyleSheet\([^)]*\)[\s\S]*?this\._styleElements\.push\(this\._globalStyleElement\)[\s\S]*?return\s+Disposable\.None[\s\S]*?\}/;

      const newRegister = `_registerRegularEditorContainer() {
        if (!this._globalStyleElement) {
            this._globalStyleElement = createStyleSheet(undefined, style => {
                style.className = 'monaco-colors';
                style.textContent = this._allCSS;
            });
            this._styleElements.push(this._globalStyleElement);
            this.__wv2Fix();
        }
        return Disposable.None;
    }`;

      if (registerPattern.test(result)) {
        result = result.replace(registerPattern, newRegister);
      } else {
        // Fallback: try exact string match
        const oldRegister = `_registerRegularEditorContainer() {
        if (!this._globalStyleElement) {
            this._globalStyleElement = createStyleSheet(undefined, style => {
                style.className = 'monaco-colors';
                style.textContent = this._allCSS;
            });
            this._styleElements.push(this._globalStyleElement);
        }
        return Disposable.None;
    }`;
        if (result.includes(oldRegister)) {
          result = result.replace(oldRegister, newRegister);
        } else {
          console.warn('[monaco-webview2-css-fix] Could not find _registerRegularEditorContainer method to patch');
        }
      }

      return { code: result, map: null };
    },
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function copyMaterialIcons(): Plugin {
  const iconsSource = path.resolve(
    __dirname,
    'node_modules/vscode-material-icons/generated/icons',
  );
  const iconsDest = path.resolve(__dirname, 'public/material-icons');

  return {
    name: 'copy-material-icons',
    buildStart() {
      if (!fs.existsSync(iconsSource)) {
        return;
      }
      fs.mkdirSync(iconsDest, { recursive: true });
      fs.cpSync(iconsSource, iconsDest, { recursive: true });
    },
  };
}

const WATCH_ALLOWLIST_FILES = new Set([
  'index.html',
  'vite.config.ts',
  'package.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'eslint.config.js',
]);

function normalizeWatchPath(input: string): string {
  return input.replace(/\\/g, '/');
}

function shouldIgnoreViteWatchPath(watchedPath: string): boolean {
  const normalizedRoot = normalizeWatchPath(path.resolve(__dirname));
  const normalizedPath = normalizeWatchPath(path.resolve(watchedPath));

  if (!normalizedPath.startsWith(normalizedRoot)) {
    return true;
  }

  const relativePath = normalizeWatchPath(path.relative(__dirname, watchedPath));

  if (!relativePath || relativePath === '.') {
    return false;
  }

  if (relativePath === 'src' || relativePath.startsWith('src/')) {
    return false;
  }

  if (relativePath === 'public' || relativePath.startsWith('public/')) {
    return false;
  }

  if (relativePath === 'src-tauri' || relativePath.startsWith('src-tauri/')) {
    return true;
  }

  return !WATCH_ALLOWLIST_FILES.has(relativePath);
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    copyMaterialIcons(),
    monacoStaticImports(),
    monacoWebView2CSSFix(),
  ],

  build: {
    // 启用更快的压缩算法
    minify: 'esbuild',
    // 启用CSS代码分割
    cssCodeSplit: true,
    // 优化源映射
    sourcemap: 'hidden',
    // 启用rollup的tree-shaking
    treeshake: {
      preset: 'recommended',
      moduleSideEffects: 'no-external'
    },
    // 优化chunk大小警告限制
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // 更细粒度的分割
            if (id.includes('monaco-editor')) return 'vendor-monaco';
            if (id.includes('@monaco-editor/react')) return 'vendor-monaco-react';
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
            if (id.includes('@tauri-apps')) return 'vendor-tauri';
            if (id.includes('xterm')) return 'vendor-xterm';
            if (id.includes('@dnd-kit')) return 'vendor-dnd';
            if (id.includes('react-virtuoso')) return 'vendor-virtuoso';
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-')) return 'vendor-markdown';
            if (id.includes('zustand')) return 'vendor-zustand';
            // 按使用频率分组
            if (id.includes('lodash') || id.includes('date-fns')) return 'vendor-utils';
            return 'vendor-other';
          }
        },
      },
    },
  },

  // 优化依赖预构建
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@tauri-apps/api',
      'monaco-editor',
      'zustand',
      '@monaco-editor/react',
      'react-virtuoso',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities'
    ],
    exclude: ['@tauri-apps/plugin-*']
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Restrict dev-server reloads to the editor app itself.
      // This prevents editing arbitrary project files in the workspace from reloading Tauri.
      ignored: shouldIgnoreViteWatchPath,
      // On Windows, use polling to avoid EBUSY errors caused by file handle contention
      // between Vite's watcher, the editor's file operations, and OS indexing services.
      usePolling: true,
      interval: 100,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: 'src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/features/agent-engine/**/*.ts',
        'src/stores/**/*.ts',
        'src/utils/agentPersistence.ts',
        'src/utils/agentTools.ts',
        'src/utils/rulesInjector.ts',
        'src/utils/contextBudget.ts',
      ],
      exclude: [
        'src/features/agent-engine/__tests__/**',
        'src/features/agent-engine/types.ts',
        'src/utils/__tests__/**',
        'src/stores/__tests__/**',
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 40,
        lines: 40,
      },
    },
  },
}));
