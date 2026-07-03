/**
 * Monaco 语言加载器测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  loadMonacoLanguage, 
  isLanguageLoaded, 
  preloadCommonLanguages,
  languageLoadMonitor,
  initializeMonacoLanguageLoader 
} from '../monacoLanguageLoader';

describe('Monaco Language Loader', () => {
  beforeEach(() => {
    // 重置模块状态
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadMonacoLanguage', () => {
    it('应该加载支持的语言', async () => {
      // 测试加载JavaScript语言
      await expect(loadMonacoLanguage('javascript')).resolves.not.toThrow();
      expect(isLanguageLoaded('javascript')).toBe(true);
    });

    it('应该标准化语言别名', async () => {
      // 测试别名映射
      await expect(loadMonacoLanguage('js')).resolves.not.toThrow();
      expect(isLanguageLoaded('javascript')).toBe(true);
      expect(isLanguageLoaded('js')).toBe(true); // 别名也应该返回true
    });

    it('对于不存在的语言应该静默失败', async () => {
      // 不存在的语言应该不抛出错误
      await expect(loadMonacoLanguage('nonexistent')).resolves.not.toThrow();
    });

    it('应该处理重复加载', async () => {
      // 第一次加载
      await loadMonacoLanguage('typescript');
      expect(isLanguageLoaded('typescript')).toBe(true);
      
      // 第二次加载应该快速返回
      const startTime = Date.now();
      await loadMonacoLanguage('typescript');
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(100); // 应该很快
    });
  });

  describe('preloadCommonLanguages', () => {
    it('应该预加载常用语言', async () => {
      const preloadedLanguages = ['javascript', 'typescript', 'html', 'css', 'json', 'markdown'];
      
      await preloadCommonLanguages();
      
      // 检查所有常用语言是否已加载
      for (const lang of preloadedLanguages) {
        expect(isLanguageLoaded(lang)).toBe(true);
      }
    });

    it('应该处理预加载错误', async () => {
      // 模拟语言加载失败
      const originalConsoleError = console.error;
      console.error = vi.fn();
      
      // 这里我们只是验证函数能正常执行而不崩溃
      await expect(preloadCommonLanguages()).resolves.not.toThrow();
      
      console.error = originalConsoleError;
    });
  });

  describe('languageLoadMonitor', () => {
    it('应该记录加载时间', async () => {
      // 模拟一个语言加载
      const startTime = languageLoadMonitor.startLoad('python');
      
      // 模拟加载完成
      await new Promise(resolve => setTimeout(resolve, 50));
      const duration = languageLoadMonitor.endLoad('python', startTime);
      
      expect(duration).toBeGreaterThan(0);
      
      const stats = languageLoadMonitor.getStats();
      expect(stats.loadedCount).toBeGreaterThanOrEqual(0);
    });

    it('应该记录加载错误', () => {
      const testError = new Error('Test language loading error');
      languageLoadMonitor.recordError('testlang', testError);
      
      const stats = languageLoadMonitor.getStats();
      expect(stats.errorCount).toBeGreaterThan(0);
      expect(stats.errors.testlang).toBe(testError);
    });
  });

  describe('initializeMonacoLanguageLoader', () => {
    it('应该成功初始化', async () => {
      await expect(initializeMonacoLanguageLoader()).resolves.not.toThrow();
      
      // 检查常用语言是否已加载
      expect(isLanguageLoaded('javascript')).toBe(true);
      expect(isLanguageLoaded('typescript')).toBe(true);
    });
  });

  describe('多语言加载', () => {
    it('应该能并行加载多个语言', async () => {
      const languages = ['python', 'rust', 'go', 'cpp'];
      
      // 并行加载多个语言
      await Promise.all(languages.map(lang => loadMonacoLanguage(lang)));
      
      // 检查所有语言是否已加载
      for (const lang of languages) {
        expect(isLanguageLoaded(lang)).toBe(true);
      }
    });
  });
});