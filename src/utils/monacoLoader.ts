/**
 * Monaco Editor 加载器统一入口
 */

/**
 * 初始化Monaco编辑器系统
 * 建议在应用启动时调用
 */
export async function initializeMonacoSystem(): Promise<void> {
  try {
    console.warn('[MonacoSystem] Initializing Monaco editor system...');

    // 初始化语言加载器
    await import('./monacoLanguageLoader').then(({ initializeMonacoLanguageLoader }) =>
      initializeMonacoLanguageLoader()
    );

    // 初始化语言管理器
    await import('./monacoLanguageManager').then(({ initializeLanguageManager }) =>
      initializeLanguageManager()
    );

    console.warn('[MonacoSystem] Monaco editor system initialized successfully');
  } catch (error) {
    console.error('[MonacoSystem] Failed to initialize Monaco editor system:', error);
  }
}
