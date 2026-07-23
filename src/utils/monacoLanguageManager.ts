/**
 * Monaco Editor 语言管理器
 *
 * 管理Monaco Editor的语言注册和配置，与按需加载系统集成。
 * 提供语言配置的集中管理，避免在多个地方重复定义。
 */

import type * as Monaco from 'monaco-editor';

// 语言配置接口
interface LanguageConfig {
  id: string;
  aliases?: string[];
  extensions?: string[];
  mimetypes?: string[];
  loader: () => Promise<any>;
  richLanguage?: boolean;
  basicLanguage?: boolean;
  configuration?: Monaco.languages.LanguageConfiguration;
  tokensProvider?: any;
}

// 语言配置映射
const languageConfigs: Record<string, LanguageConfig> = {
  javascript: {
    id: 'javascript',
    aliases: ['js', 'jsx', 'mjs', 'cjs'],
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    mimetypes: ['text/javascript', 'application/javascript'],
    loader: () =>
      import('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js'),
    basicLanguage: true,
  },
  typescript: {
    id: 'typescript',
    aliases: ['ts', 'tsx'],
    extensions: ['.ts', '.tsx'],
    mimetypes: ['text/typescript', 'application/typescript'],
    loader: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
    richLanguage: true,
  },
  html: {
    id: 'html',
    extensions: ['.html', '.htm', '.shtml', '.xhtml'],
    mimetypes: ['text/html'],
    loader: () => import('monaco-editor/esm/vs/language/html/monaco.contribution.js'),
    richLanguage: true,
  },
  css: {
    id: 'css',
    extensions: ['.css'],
    mimetypes: ['text/css'],
    loader: () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
    richLanguage: true,
  },
  scss: {
    id: 'scss',
    aliases: ['sass'],
    extensions: ['.scss', '.sass'],
    mimetypes: ['text/x-scss', 'text/x-sass'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js'),
    basicLanguage: true,
  },
  less: {
    id: 'less',
    extensions: ['.less'],
    mimetypes: ['text/x-less'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/less/less.contribution.js'),
    basicLanguage: true,
  },
  json: {
    id: 'json',
    extensions: ['.json'],
    mimetypes: ['application/json'],
    loader: () => import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
    richLanguage: true,
  },
  yaml: {
    id: 'yaml',
    aliases: ['yml'],
    extensions: ['.yaml', '.yml'],
    mimetypes: ['text/yaml', 'text/x-yaml', 'application/yaml'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js'),
    basicLanguage: true,
  },
  xml: {
    id: 'xml',
    extensions: ['.xml', '.xsl', '.xsd', '.svg'],
    mimetypes: ['text/xml', 'application/xml', 'image/svg+xml'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js'),
    basicLanguage: true,
  },
  markdown: {
    id: 'markdown',
    aliases: ['md', 'mdx'],
    extensions: ['.md', '.markdown', '.mdx'],
    mimetypes: ['text/markdown', 'text/x-markdown'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'),
    basicLanguage: true,
  },
  python: {
    id: 'python',
    aliases: ['py'],
    extensions: ['.py', '.pyw', '.pyi'],
    mimetypes: ['text/x-python', 'application/x-python'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js'),
    basicLanguage: true,
  },
  rust: {
    id: 'rust',
    aliases: ['rs'],
    extensions: ['.rs'],
    mimetypes: ['text/x-rust', 'application/x-rust'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js'),
    basicLanguage: true,
  },
  go: {
    id: 'go',
    aliases: ['golang'],
    extensions: ['.go'],
    mimetypes: ['text/x-go', 'application/x-go'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/go/go.contribution.js'),
    basicLanguage: true,
  },
  cpp: {
    id: 'cpp',
    aliases: ['c++', 'cxx'],
    extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
    mimetypes: ['text/x-c++src', 'text/x-c++hdr'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'),
    basicLanguage: true,
  },
  shell: {
    id: 'shell',
    aliases: ['bash', 'sh', 'zsh'],
    extensions: ['.sh', '.bash', '.zsh'],
    mimetypes: ['text/x-sh', 'text/x-bash', 'text/x-shellscript'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js'),
    basicLanguage: true,
  },
  sql: {
    id: 'sql',
    extensions: ['.sql'],
    mimetypes: ['text/x-sql', 'application/sql'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'),
    basicLanguage: true,
  },
  dockerfile: {
    id: 'dockerfile',
    aliases: ['docker'],
    extensions: ['.dockerfile', 'Dockerfile'],
    mimetypes: ['text/x-dockerfile'],
    loader: () =>
      import('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js'),
    basicLanguage: true,
  },
  csharp: {
    id: 'csharp',
    aliases: ['cs'],
    extensions: ['.cs'],
    mimetypes: ['text/x-csharp', 'application/x-csharp'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js'),
    basicLanguage: true,
  },
  java: {
    id: 'java',
    extensions: ['.java'],
    mimetypes: ['text/x-java', 'application/x-java'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/java/java.contribution.js'),
    basicLanguage: true,
  },
  php: {
    id: 'php',
    extensions: ['.php', '.php3', '.php4', '.php5', '.phtml'],
    mimetypes: ['text/x-php', 'application/x-php'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/php/php.contribution.js'),
    basicLanguage: true,
  },
  ruby: {
    id: 'ruby',
    aliases: ['rb'],
    extensions: ['.rb', '.ruby'],
    mimetypes: ['text/x-ruby', 'application/x-ruby'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js'),
    basicLanguage: true,
  },
  swift: {
    id: 'swift',
    extensions: ['.swift'],
    mimetypes: ['text/x-swift', 'application/x-swift'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js'),
    basicLanguage: true,
  },
  kotlin: {
    id: 'kotlin',
    aliases: ['kt'],
    extensions: ['.kt', '.kts'],
    mimetypes: ['text/x-kotlin', 'application/x-kotlin'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js'),
    basicLanguage: true,
  },
  scala: {
    id: 'scala',
    extensions: ['.scala', '.sc'],
    mimetypes: ['text/x-scala', 'application/x-scala'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/scala/scala.contribution.js'),
    basicLanguage: true,
  },
  ini: {
    id: 'ini',
    aliases: ['cfg', 'conf'],
    extensions: ['.ini', '.cfg', '.conf'],
    mimetypes: ['text/x-ini', 'text/plain'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js'),
    basicLanguage: true,
  },
  plaintext: {
    id: 'plaintext',
    aliases: ['txt', 'text'],
    extensions: ['.txt', '.text'],
    mimetypes: ['text/plain'],
    loader: () => Promise.resolve(null),
  },
};

// 已注册的语言
const registeredLanguages = new Set<string>();

/**
 * 获取语言配置
 */
function getLanguageConfig(language: string): LanguageConfig | null {
  const normalized = normalizeLanguageId(language);
  return languageConfigs[normalized] || null;
}

/**
 * 标准化语言ID
 */
function normalizeLanguageId(language: string): string {
  const normalized = language.toLowerCase();

  // 检查别名
  for (const [langId, config] of Object.entries(languageConfigs)) {
    if (config.aliases?.includes(normalized)) {
      return langId;
    }
  }

  // 检查扩展名
  if (normalized.startsWith('.')) {
    for (const [langId, config] of Object.entries(languageConfigs)) {
      if (config.extensions?.includes(normalized)) {
        return langId;
      }
    }
  }

  // 直接匹配
  return languageConfigs[normalized] ? normalized : 'plaintext';
}

async function registerLanguage(language: string): Promise<boolean> {
  const langId = normalizeLanguageId(language);

  // 检查是否已注册
  if (registeredLanguages.has(langId)) {
    return true;
  }

  const config = getLanguageConfig(langId);
  if (!config) {
    console.warn(
      `[MonacoLanguageManager] No config found for language: ${language} (normalized: ${langId})`
    );
    return false;
  }

  try {
    // 加载语言模块
    if (config.loader) {
      await config.loader();
    }

    // 标记为已注册
    registeredLanguages.add(langId);
    console.warn(`[MonacoLanguageManager] Registered language: ${langId}`);

    return true;
  } catch (error) {
    console.error(`[MonacoLanguageManager] Failed to register language ${langId}:`, error);
    return false;
  }
}

/**
 * 批量注册语言
 */
async function registerLanguages(languageIds: string[]): Promise<void> {
  const uniqueLangs = [...new Set(languageIds.map((l) => normalizeLanguageId(l)))];
  const promises = uniqueLangs.map((langId) => registerLanguage(langId));
  await Promise.all(promises);
}

/**
 * 初始化语言管理器
 */
export async function initializeLanguageManager(): Promise<void> {
  try {
    // 预注册一些常用语言
    const commonLanguages = ['javascript', 'typescript', 'html', 'css', 'json', 'markdown'];
    await registerLanguages(commonLanguages);

    console.warn(`[MonacoLanguageManager] Initialized with ${registeredLanguages.size} languages`);
  } catch (error) {
    console.error('[MonacoLanguageManager] Failed to initialize:', error);
  }
}
