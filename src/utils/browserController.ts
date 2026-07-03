/**
 * 浏览器控制事件总线
 *
 * 提供全局的浏览器控制接口，允许 AI 工具层控制 UI 组件中的浏览器行为。
 * 使用浏览器原生 EventTarget API 实现事件驱动架构。
 *
 * 支持两种模式：
 * 1. iframe 模式 - 用于 localhost 预览（嵌入在编辑器中）
 * 2. WebviewWindow 模式 - 用于外部网站（打开新窗口）
 */

import { invoke } from '@tauri-apps/api/core';

// 定义浏览器操作类型
type BrowserAction =
  | { type: 'OPEN'; url?: string } // 打开浏览器标签
  | { type: 'NAVIGATE'; url: string } // 跳转到新 URL
  | { type: 'REFRESH' }; // 刷新当前页面

// 定义浏览器事件接口
export interface BrowserActionEvent extends CustomEvent {
  detail: BrowserAction;
}

// 浏览器窗口状态
interface BrowserWindowStatus {
  is_open: boolean;
  label: string | null;
}

/**
 * 浏览器控制器类
 *
 * 使用 EventTarget 作为基类，提供事件发布/订阅能力
 */
class BrowserController extends EventTarget {
  private static readonly EVENT_NAME = 'browser-action';
  private static readonly DEFAULT_URL = 'http://localhost:3000';

  /**
   * 打开浏览器标签（iframe 模式，用于 localhost）
   * @param url 要访问的 URL，默认为 localhost:3000
   */
  open(url?: string): void {
    const targetUrl = url || BrowserController.DEFAULT_URL;
    this.dispatchEvent(
      new CustomEvent<BrowserAction>(BrowserController.EVENT_NAME, {
        detail: { type: 'OPEN', url: targetUrl },
      })
    );
  }

  /**
   * 在已打开的浏览器中跳转到新 URL（iframe 模式）
   * @param url 目标 URL
   */
  navigate(url: string): void {
    if (!url) {
      throw new Error('navigate() 需要提供 url 参数');
    }
    this.dispatchEvent(
      new CustomEvent<BrowserAction>(BrowserController.EVENT_NAME, {
        detail: { type: 'NAVIGATE', url },
      })
    );
  }

  /**
   * 刷新当前浏览器页面（iframe 模式）
   */
  refresh(): void {
    this.dispatchEvent(
      new CustomEvent<BrowserAction>(BrowserController.EVENT_NAME, {
        detail: { type: 'REFRESH' },
      })
    );
  }

  // ==================== WebviewWindow 模式（支持外部网站）====================

  /**
   * 打开独立的浏览器窗口（WebviewWindow 模式）
   * 此方法可以访问外部网站，无 iframe 跨域限制
   * @param url 要访问的 URL
   */
  async openWindow(url: string): Promise<void> {
    const targetUrl = url || BrowserController.DEFAULT_URL;
    await invoke('open_browser_window', { url: targetUrl });
  }

  /**
   * 在已打开的浏览器窗口中导航到新 URL
   * @param url 目标 URL
   */
  async navigateTo(url: string): Promise<void> {
    if (!url) {
      throw new Error('navigateTo() 需要提供 url 参数');
    }
    await invoke('navigate_browser', { url });
  }

  /**
   * 关闭浏览器窗口
   */
  async closeWindow(): Promise<void> {
    await invoke('close_browser_window');
  }

  /**
   * 获取浏览器窗口状态
   */
  async getStatus(): Promise<BrowserWindowStatus> {
    return await invoke('get_browser_status');
  }
}

// 导出全局单例
export const browserController = new BrowserController();
