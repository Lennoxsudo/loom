/**
 * Monaco Editor 语言按需加载系统
 *
 * 在用户实际需要某种语言时才加载对应的语言支持，减少初始包大小。
 */

// 已加载的语言记录
const loadedLanguages = new Set<string>();

// 语言定义映射
const languageDefinitions: Record<
  string,
  {
    loader: () => Promise<any>;
    basicLanguage?: boolean;
    richLanguage?: boolean;
  }
> = {
  // TypeScript/JavaScript
  typescript: {
    loader: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
    richLanguage: true,
  },
  javascript: {
    loader: () =>
      import('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js'),
    basicLanguage: true,
  },

  // Web相关
  html: {
    loader: () => import('monaco-editor/esm/vs/language/html/monaco.contribution.js'),
    richLanguage: true,
  },
  css: {
    loader: () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
    richLanguage: true,
  },
  scss: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js'),
    basicLanguage: true,
  },
  less: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/less/less.contribution.js'),
    basicLanguage: true,
  },

  // 数据格式
  json: {
    loader: () => import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
    richLanguage: true,
  },
  yaml: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js'),
    basicLanguage: true,
  },
  xml: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js'),
    basicLanguage: true,
  },

  // 编程语言
  python: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js'),
    basicLanguage: true,
  },
  rust: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js'),
    basicLanguage: true,
  },
  go: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/go/go.contribution.js'),
    basicLanguage: true,
  },
  cpp: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'),
    basicLanguage: true,
  },
  csharp: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js'),
    basicLanguage: true,
  },
  java: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/java/java.contribution.js'),
    basicLanguage: true,
  },

  // 标记语言
  markdown: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'),
    basicLanguage: true,
  },

  // 配置和脚本
  shell: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js'),
    basicLanguage: true,
  },
  dockerfile: {
    loader: () =>
      import('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js'),
    basicLanguage: true,
  },
  sql: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'),
    basicLanguage: true,
  },
  ini: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js'),
    basicLanguage: true,
  },
  php: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/php/php.contribution.js'),
    basicLanguage: true,
  },
  ruby: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js'),
    basicLanguage: true,
  },
  swift: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js'),
    basicLanguage: true,
  },
  kotlin: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js'),
    basicLanguage: true,
  },
  scala: {
    loader: () => import('monaco-editor/esm/vs/basic-languages/scala/scala.contribution.js'),
    basicLanguage: true,
  },
};

// 语言别名映射
const languageAliases: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  text: 'plaintext',
  yml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  md: 'markdown',
  mdx: 'markdown',
  cs: 'csharp',
  py: 'python',
  rs: 'rust',
  go: 'golang',
  rb: 'ruby',
  php: 'php',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  scala: 'scala',
};

/**
 * 按需加载Monaco语言
 * @param language 语言ID（如'typescript'、'javascript'）
 * @returns Promise，加载完成后resolve
 */
export async function loadMonacoLanguage(language: string): Promise<void> {
  // 标准化语言ID
  const normalizedLang = languageAliases[language.toLowerCase()] || language.toLowerCase();

  // 检查是否已加载
  if (loadedLanguages.has(normalizedLang)) {
    return;
  }

  // 检查是否支持该语言
  const definition = languageDefinitions[normalizedLang];
  if (!definition) {
    console.warn(
      `[MonacoLoader] Language "${language}" (normalized: "${normalizedLang}") not supported for lazy loading`
    );
    return;
  }

  try {
    console.warn(`[MonacoLoader] Loading language: ${normalizedLang}`);

    // 加载语言模块
    await definition.loader();
    loadedLanguages.add(normalizedLang);

    console.warn(`[MonacoLoader] Language "${normalizedLang}" loaded successfully`);
  } catch (error) {
    console.error(`[MonacoLoader] Failed to load language "${normalizedLang}":`, error);
    throw error;
  }
}

/**
 * 预加载常用语言（提高首次使用体验）
 */
export async function preloadCommonLanguages(): Promise<void> {
  const commonLanguages = ['javascript', 'typescript', 'html', 'css', 'json', 'markdown'];

  console.warn('[MonacoLoader] Preloading common languages:', commonLanguages);

  const loadPromises = commonLanguages.map(async (lang) => {
    try {
      await loadMonacoLanguage(lang);
    } catch (error) {
      // 预加载失败不影响主流程
      console.warn(`[MonacoLoader] Failed to preload language "${lang}":`, error);
    }
  });

  await Promise.all(loadPromises);
  console.warn('[MonacoLoader] Common languages preloaded');
}

/**
 * 批量加载语言
 * @param languages 语言ID数组
 */
export async function loadMultipleLanguages(languages: string[]): Promise<void> {
  const uniqueLangs = [
    ...new Set(languages.map((lang) => languageAliases[lang.toLowerCase()] || lang.toLowerCase())),
  ];

  const loadPromises = uniqueLangs.map(async (lang) => {
    try {
      await loadMonacoLanguage(lang);
    } catch (error) {
      console.warn(`[MonacoLoader] Failed to load language "${lang}":`, error);
    }
  });

  await Promise.all(loadPromises);
}

/**
 * 检查语言是否已加载
 */
export function isLanguageLoaded(language: string): boolean {
  const normalizedLang = languageAliases[language.toLowerCase()] || language.toLowerCase();
  return loadedLanguages.has(normalizedLang);
}

/**
 * 初始化Monaco语言加载器
 * 建议在应用启动时调用，预加载常用语言
 */
export async function initializeMonacoLanguageLoader(): Promise<void> {
  // 确保基本语言可用
  try {
    // 首先确保plaintext语言可用（Monaco默认支持）
    loadedLanguages.add('plaintext');

    // 预加载常用语言
    await preloadCommonLanguages();

    console.warn('[MonacoLoader] Language loader initialized');
  } catch (error) {
    console.error('[MonacoLoader] Failed to initialize language loader:', error);
  }
}

/**
 * 语言加载状态监控
 */
export class LanguageLoadMonitor {
  private loadTimes: Map<string, number> = new Map();
  private loadErrors: Map<string, Error> = new Map();

  startLoad(language: string): number {
    const startTime = Date.now();
    this.loadTimes.set(language, startTime);
    return startTime;
  }

  endLoad(language: string, startTime: number): number {
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.warn(`[MonacoLoader] Language "${language}" loaded in ${duration}ms`);
    return duration;
  }

  recordError(language: string, error: Error): void {
    this.loadErrors.set(language, error);
    console.error(`[MonacoLoader] Error loading language "${language}":`, error);
  }

  getStats() {
    return {
      loadedCount: loadedLanguages.size,
      loadTimes: Object.fromEntries(this.loadTimes),
      errorCount: this.loadErrors.size,
      errors: Object.fromEntries(this.loadErrors),
    };
  }
}

// 导出全局监控实例
export const languageLoadMonitor = new LanguageLoadMonitor();
