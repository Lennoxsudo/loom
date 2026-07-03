/**
 * 浏览器处理器模块
 *
 * 本模块提供浏览器相关工具的处理器实现：
 * - ControlBrowserHandler: 控制内置浏览器
 * - FetchWebContentHandler: 抓取网页内容（增强版，参照 Claude Code WebFetch）
 *
 * @module aiTools/handlers/browserHandlers
 */

import type { ToolResult } from '../../../types/ai';
import type { ToolHandler } from '../types';
import type { ControlBrowserArgs, FetchWebContentArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import { browserController } from '../../browserController';
import { validateFetchUrl, checkFetchPermission } from '../webFetchUtils';
import { getCachedContent, setCachedContent } from '../webFetchCache';

/** 控制浏览器处理器 */
class ControlBrowserHandler implements ToolHandler<'browser'> {
  name = 'browser' as const;

  async execute(args: ControlBrowserArgs): Promise<ToolResult> {
    try {
      if (!args.action) {
        throw ToolError.missingParam('action');
      }

      if (args.action === 'open') {
        browserController.open(args.url || 'http://localhost:3000');
        return { tool_call_id: '', output: `已打开浏览器: ${args.url || 'http://localhost:3000'}` };
      } else if (args.action === 'navigate') {
        browserController.navigate(args.url || 'http://localhost:3000');
        return { tool_call_id: '', output: `已导航到: ${args.url || 'http://localhost:3000'}` };
      } else if (args.action === 'refresh') {
        browserController.refresh();
        return { tool_call_id: '', output: '已刷新浏览器' };
      }
      return { tool_call_id: '', output: '', error: `未知操作: ${args.action}` };
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
        return { tool_call_id: '', output: this.formatContentOutput(cached.content, cached.bytes, cached.code, cached.codeText, url) };
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

  private formatContentOutput(content: string, bytes: number, code: number, codeText: string, url: string): string {
    return `来源: ${url}\n状态: ${code} ${codeText}\n大小: ${bytes} bytes\n\n---\n${content}`;
  }

  private redirectStatusText(code: number): string {
    switch (code) {
      case 301: return 'Moved Permanently';
      case 302: return 'Found';
      case 307: return 'Temporary Redirect';
      case 308: return 'Permanent Redirect';
      default: return String(code);
    }
  }
}

export const browserHandlers: ToolHandler[] = [
  new ControlBrowserHandler(),
  new FetchWebContentHandler(),
];
