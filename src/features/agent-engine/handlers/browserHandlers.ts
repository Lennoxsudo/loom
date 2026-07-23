/**
 * 浏览器 / 网络处理器模块
 *
 * 本模块提供浏览器与网络相关工具的处理器实现：
 * - ControlBrowserHandler: 控制内置浏览器 / CDP 浏览器
 * - FetchWebContentHandler: 抓取网页内容（增强版，参照 Claude Code WebFetch）
 * - WebSearchHandler: 原生 Web 搜索（轻量 SERP 结果入上下文）
 *
 * @module aiTools/handlers/browserHandlers
 */

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ToolResult } from '../../../types/ai';
import type { ToolHandler } from '../types';
import type { ControlBrowserArgs, FetchWebContentArgs, WebSearchArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import { browserController } from '../../../utils/browserController';
import { validateFetchUrl, checkFetchPermission } from '../webFetchUtils';
import { getCachedContent, setCachedContent } from '../webFetchCache';
import { useSettingsStore } from '../../../stores/useSettingsStore';

interface CdpActionResult {
  ok: boolean;
  message: string;
  url?: string | null;
  title?: string | null;
  content?: string | null;
  screenshotPath?: string | null;
  screenshotBase64?: string | null;
  value?: unknown;
}

function isCdpBrowserEnabled(): boolean {
  try {
    return Boolean(useSettingsStore.getState().enableCdpBrowser);
  } catch {
    return false;
  }
}

function formatCdpResult(result: CdpActionResult): string {
  const parts = [result.message];
  if (result.url) parts.push(`URL: ${result.url}`);
  if (result.title) parts.push(`Title: ${result.title}`);
  if (result.screenshotPath) parts.push(`Screenshot: ${result.screenshotPath}`);
  if (result.content) {
    const content = result.content;
    const max = 80_000;
    parts.push('---');
    parts.push(content.length > max ? `${content.slice(0, max)}\n…(truncated)` : content);
  }
  if (result.value !== undefined && result.value !== null) {
    parts.push('Value:');
    parts.push(
      typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2)
    );
  }
  if (result.screenshotBase64) {
    parts.push(`screenshot_base64_length: ${result.screenshotBase64.length}`);
  }
  return parts.join('\n');
}

async function invokeCdp(command: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  if (!isTauri()) {
    return {
      tool_call_id: '',
      output: '',
      error: 'CDP browser is only available in the desktop app.',
    };
  }
  try {
    const result = await invoke<CdpActionResult>(command, args);
    if (!result?.ok) {
      return {
        tool_call_id: '',
        output: '',
        error: result?.message || `CDP command failed: ${command}`,
      };
    }
    return { tool_call_id: '', output: formatCdpResult(result) };
  } catch (e) {
    return { tool_call_id: '', output: '', error: String(e) };
  }
}

/** 控制浏览器处理器 */
class ControlBrowserHandler implements ToolHandler<'browser'> {
  name = 'browser' as const;

  async execute(args: ControlBrowserArgs): Promise<ToolResult> {
    try {
      if (!args.action) {
        throw ToolError.missingParam('action');
      }

      const cdpEnabled = isCdpBrowserEnabled();
      const cdpActions = new Set([
        'click',
        'type',
        'press_key',
        'content',
        'evaluate',
        'wait',
        'screenshot',
        'close',
      ]);

      // CDP-only actions require the plugin switch.
      if (cdpActions.has(args.action) && !cdpEnabled) {
        return {
          tool_call_id: '',
          output: '',
          error:
            'CDP browser plugin is disabled. Enable it in Settings → Plugins, or use open/navigate/refresh on the built-in preview.',
        };
      }

      // When CDP is enabled, prefer CDP for open/navigate/refresh/close as well.
      if (cdpEnabled) {
        switch (args.action) {
          case 'open':
            return invokeCdp('cdp_browser_start', { url: args.url || 'about:blank' });
          case 'navigate':
            if (!args.url) throw ToolError.missingParam('url');
            // start creates a session if needed; if already running it navigates.
            return invokeCdp('cdp_browser_start', { url: args.url });
          case 'refresh':
            return invokeCdp('cdp_browser_refresh');
          case 'close':
            return invokeCdp('cdp_browser_stop');
          case 'click':
            if (!args.selector) throw ToolError.missingParam('selector');
            return invokeCdp('cdp_browser_click', { selector: args.selector });
          case 'type':
            if (!args.selector) throw ToolError.missingParam('selector');
            if (args.text == null) throw ToolError.missingParam('text');
            return invokeCdp('cdp_browser_type', {
              selector: args.selector,
              text: args.text,
              clear: args.clear ?? false,
            });
          case 'press_key':
            if (!args.key) throw ToolError.missingParam('key');
            return invokeCdp('cdp_browser_press_key', { key: args.key });
          case 'content':
            return invokeCdp('cdp_browser_content');
          case 'evaluate':
            if (!args.expression) throw ToolError.missingParam('expression');
            return invokeCdp('cdp_browser_evaluate', { expression: args.expression });
          case 'wait':
            if (!args.selector) throw ToolError.missingParam('selector');
            return invokeCdp('cdp_browser_wait_for_selector', {
              selector: args.selector,
              timeoutMs: args.timeout_ms ?? 10_000,
            });
          case 'screenshot':
            return invokeCdp('cdp_browser_screenshot', {
              fullPage: args.full_page ?? false,
              includeBase64: args.include_base64 ?? false,
            });
          default:
            return { tool_call_id: '', output: '', error: `未知操作: ${args.action}` };
        }
      }

      // Built-in preview path (iframe / webview window events)
      if (args.action === 'open') {
        browserController.open(args.url || 'http://localhost:3000');
        return { tool_call_id: '', output: `已打开浏览器: ${args.url || 'http://localhost:3000'}` };
      }
      if (args.action === 'navigate') {
        browserController.navigate(args.url || 'http://localhost:3000');
        return { tool_call_id: '', output: `已导航到: ${args.url || 'http://localhost:3000'}` };
      }
      if (args.action === 'refresh') {
        browserController.refresh();
        return { tool_call_id: '', output: '已刷新浏览器' };
      }
      if (args.action === 'close') {
        try {
          await browserController.closeWindow();
        } catch {
          // preview panel has no close command
        }
        return { tool_call_id: '', output: '已关闭浏览器窗口（如有）' };
      }

      return {
        tool_call_id: '',
        output: '',
        error: `未知操作: ${args.action}`,
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

/** 增强版抓取网页内容处理器（参照 Claude Code WebFetch） */
class FetchWebContentHandler implements ToolHandler<'fetch'> {
  name = 'fetch' as const;

  async execute(args: FetchWebContentArgs): Promise<ToolResult> {
    try {
      if (!args.url) {
        throw ToolError.missingParam('url');
      }

      // 1. URL 验证（长度、格式、公网、无凭据、HTTPS 升级）
      const validation = validateFetchUrl(args.url);
      if (!validation.valid) {
        return { tool_call_id: '', output: '', error: validation.error };
      }
      const url = validation.upgradedUrl ?? args.url;

      // 2. 查 LRU 缓存
      const cached = getCachedContent(url);
      if (cached) {
        return {
          tool_call_id: '',
          output: this.formatContentOutput(
            cached.content,
            cached.bytes,
            cached.code,
            cached.codeText,
            url
          ),
        };
      }

      // 3. 权限检查（白名单→deny→allow→默认 allow）
      const permission = checkFetchPermission(url);
      if (permission === 'deny') {
        return { tool_call_id: '', output: '', error: `域名访问被拒绝: ${new URL(url).hostname}` };
      }

      // 4. 调用 Rust 后端（fetch_web_content_v3）
      let result: {
        type: string;
        url: string;
        content?: string;
        bytes?: number;
        code?: number;
        code_text?: string;
        content_type?: string;
        persisted_path?: string;
        redirect_to?: string;
        redirect_status?: number;
      };

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        result = await invoke('fetch_web_content_v3', {
          url,
          method: args.method,
          headers: args.headers,
          body: args.body,
          timeout: args.timeout,
          followRedirects: args.follow_redirects,
          extractLinks: args.extract_links,
        });
      } catch (e) {
        return { tool_call_id: '', output: '', error: `请求失败: ${e}` };
      }

      // 5. 处理重定向（跨域重定向提示 AI 重新请求）
      if (result.type === 'redirect') {
        const statusText = this.redirectStatusText(result.redirect_status ?? 0);
        return {
          tool_call_id: '',
          output: `网页已重定向: ${result.url} → ${result.redirect_to} (${result.redirect_status} ${statusText})。请使用新 URL 重新请求 fetch_web_content。`,
        };
      }

      // 6. 处理二进制内容（PDF 等）
      if (result.type === 'binary') {
        const sizeKB = ((result.bytes ?? 0) / 1024).toFixed(1);
        return {
          tool_call_id: '',
          output: `文件已下载到: ${result.persisted_path} (${sizeKB}KB, 类型: ${result.content_type})`,
        };
      }

      // 7. 处理文本内容
      const content = result.content ?? '';
      const bytes = result.bytes ?? 0;
      const code = result.code ?? 200;
      const codeText = result.code_text ?? 'OK';

      // 8. 写入缓存
      if (content) {
        setCachedContent(url, {
          content,
          bytes,
          code,
          codeText,
          contentType: result.content_type ?? '',
          timestamp: Date.now(),
        });
      }

      // 9. 返回结果
      return {
        tool_call_id: '',
        output: this.formatContentOutput(content, bytes, code, codeText, url),
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }

  private formatContentOutput(
    content: string,
    bytes: number,
    code: number,
    codeText: string,
    url: string
  ): string {
    return `来源: ${url}\n状态: ${code} ${codeText}\n大小: ${bytes} bytes\n\n---\n${content}`;
  }

  private redirectStatusText(code: number): string {
    switch (code) {
      case 301:
        return 'Moved Permanently';
      case 302:
        return 'Found';
      case 307:
        return 'Temporary Redirect';
      case 308:
        return 'Permanent Redirect';
      default:
        return String(code);
    }
  }
}

/** 原生 Web 搜索处理器 — 轻量结果直接入上下文，区别于 fetch / browser */
class WebSearchHandler implements ToolHandler<'web_search'> {
  name = 'web_search' as const;

  async execute(args: WebSearchArgs): Promise<ToolResult> {
    try {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) {
        throw ToolError.missingParam('query');
      }

      let numResults: number | undefined;
      if (args.num_results !== undefined && args.num_results !== null) {
        const n = Number(args.num_results);
        if (!Number.isFinite(n) || n < 1) {
          return { tool_call_id: '', output: '', error: 'num_results 必须是 1–10 之间的正整数' };
        }
        numResults = Math.min(10, Math.floor(n));
      }

      type WebSearchItem = { title: string; url: string; snippet: string };
      type WebSearchResponse = {
        query: string;
        results: WebSearchItem[];
        count: number;
        provider: string;
      };

      let result: WebSearchResponse;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        result = await invoke<WebSearchResponse>('web_search', {
          query,
          numResults,
        });
      } catch (e) {
        return { tool_call_id: '', output: '', error: `搜索失败: ${e}` };
      }

      return {
        tool_call_id: '',
        output: this.formatOutput(result),
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }

  private formatOutput(result: {
    query: string;
    results: Array<{ title: string; url: string; snippet: string }>;
    count: number;
    provider: string;
  }): string {
    if (!result.results?.length) {
      return (
        `搜索: "${result.query}"\n结果: 0\n\n` +
        '未找到相关结果。可改用更具体的关键词，或用 fetch 直接打开已知 URL。'
      );
    }

    const lines: string[] = [
      `搜索: "${result.query}"`,
      `结果: ${result.count}（来源: ${result.provider || 'duckduckgo'}）`,
      '',
    ];

    result.results.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title}`);
      lines.push(`   URL: ${item.url}`);
      if (item.snippet) {
        lines.push(`   摘要: ${item.snippet}`);
      }
      lines.push('');
    });

    lines.push('提示: 需要完整页面内容时，对感兴趣的 URL 使用 fetch 工具。');
    return lines.join('\n');
  }
}

export const browserHandlers: ToolHandler[] = [
  new ControlBrowserHandler(),
  new FetchWebContentHandler(),
  new WebSearchHandler(),
];
