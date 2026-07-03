import { languages } from 'monaco-editor';

// 基础语言 (贡献文件 - 注册语言 + 懒加载)
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/less/less.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js';

// 核心语言
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/html/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/css/monaco.contribution.js';

// 直接导入语言定义文件，用于 WebView2 生产环境的延迟注册
// @ts-expect-error no type declarations for Monaco internal modules
import * as tsLang from 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as jsLang from 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as cssLang from 'monaco-editor/esm/vs/basic-languages/css/css.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as scssLang from 'monaco-editor/esm/vs/basic-languages/scss/scss.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as lessLang from 'monaco-editor/esm/vs/basic-languages/less/less.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as htmlLang from 'monaco-editor/esm/vs/basic-languages/html/html.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as mdLang from 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as rustLang from 'monaco-editor/esm/vs/basic-languages/rust/rust.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as goLang from 'monaco-editor/esm/vs/basic-languages/go/go.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as pyLang from 'monaco-editor/esm/vs/basic-languages/python/python.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as cppLang from 'monaco-editor/esm/vs/basic-languages/cpp/cpp.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as shellLang from 'monaco-editor/esm/vs/basic-languages/shell/shell.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as yamlLang from 'monaco-editor/esm/vs/basic-languages/yaml/yaml.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as sqlLang from 'monaco-editor/esm/vs/basic-languages/sql/sql.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as xmlLang from 'monaco-editor/esm/vs/basic-languages/xml/xml.js';
// @ts-expect-error no type declarations for Monaco internal modules
import * as dockerLang from 'monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.js';

/**
 * WebView2 生产环境修复：延迟重新注册所有 tokenizer
 *
 * 在 WebView2 生产环境 (tauri.localhost) 中，monacoStaticImports 插件
 * 在模块求值时调用的 setMonarchTokensProvider 可能不会生效。
 * 原因可能是 Monaco 内部服务在模块求值时还未完全初始化。
 *
 * 此函数在编辑器创建后延迟调用，确保服务已就绪。
 */
const LANG_MODULES: Record<string, Record<string, unknown>> = {
  typescript: tsLang,
  javascript: jsLang,
  css: cssLang,
  scss: scssLang,
  less: lessLang,
  html: htmlLang,
  markdown: mdLang,
  rust: rustLang,
  go: goLang,
  python: pyLang,
  cpp: cppLang,
  shell: shellLang,
  yaml: yamlLang,
  sql: sqlLang,
  xml: xmlLang,
  dockerfile: dockerLang,
};

export function forceRegisterTokenizers() {
  let registered = 0;
  for (const [langId, mod] of Object.entries(LANG_MODULES)) {
    try {
      const existingLangs = languages.getLanguages();
      if (!existingLangs.some(l => l.id === langId)) {
        languages.register({ id: langId });
      }
      if (mod.language) {
        languages.setMonarchTokensProvider(langId, mod.language as Parameters<typeof languages.setMonarchTokensProvider>[1]);
        registered++;
      }
      if (mod.conf) {
        languages.setLanguageConfiguration(langId, mod.conf as Parameters<typeof languages.setLanguageConfiguration>[1]);
      }
    } catch {
      // ignore
    }
  }
  return registered;
}
