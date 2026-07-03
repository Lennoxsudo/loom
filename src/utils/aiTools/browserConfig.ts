/**
 * 浏览器工具配置模块
 *
 * 提供浏览器工具的配置和集成功能
 */

import type { ToolDefinition } from '../../types/ai';

const BUILTIN_BROWSER_TOOLS: ToolDefinition[] = [
  {
    name: 'browser',
    description:
      'Control the built-in browser window. Available actions: ' +
      'open - open the built-in browser and navigate to a URL; ' +
      'navigate - navigate the browser to a new URL; ' +
      'refresh - refresh the current page.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'navigate', 'refresh'],
          description: 'The browser action to perform.',
        },
        url: {
          type: 'string',
          description: 'The URL to navigate to. Required for open and navigate actions. Ignored for refresh.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'fetch',
    description:
      'Fetch web content and convert to Markdown. Supports custom HTTP methods (POST/PUT/DELETE/PATCH/HEAD), ' +
      'custom headers (Authorization, Cookie, etc.), request body for API testing, configurable timeout, ' +
      'redirect control, and link extraction. ' +
      'Non-200 responses still return body content when available (e.g., 404 pages with useful info). ' +
      'For SPA pages that require JavaScript rendering, use the browser tool instead.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch. Must be publicly accessible (http/https). HTTP is auto-upgraded to HTTPS.',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
          description: 'HTTP method. Default is GET. Use POST/PUT for API testing.',
        },
        headers: {
          type: 'object',
          description: 'Custom request headers as key-value pairs. E.g., {"Authorization": "Bearer token", "Cookie": "session=abc"}',
        },
        body: {
          type: 'string',
          description: 'Request body for POST/PUT/PATCH. Can be JSON string, form data, etc.',
        },
        timeout: {
          type: 'number',
          description: 'Request timeout in seconds. Default is 60. Increase for slow websites.',
        },
        follow_redirects: {
          type: 'boolean',
          description: 'Whether to follow HTTP redirects. Default is true. Set false to debug redirect chains.',
        },
        extract_links: {
          type: 'boolean',
          description: 'Whether to extract and list all links from HTML pages. Default false. Useful for crawling multi-page content.',
        },
      },
      required: ['url'],
    },
  },
];

export function dedupeToolsByName(tools: ToolDefinition[]): ToolDefinition[] {
  const deduped = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    deduped.set(tool.name, tool);
  }
  return Array.from(deduped.values());
}

/**
 * 获取包含浏览器工具配置的完整工具列表
 *
 * 该函数会过滤掉基础工具列表中的浏览器工具（control_browser、fetch_web_content），
 * 并始终使用内置的浏览器工具实现。
 *
 * @param baseTools - 基础工具列表
 * @returns 包含内置浏览器工具的完整工具列表
 *
 * @example
 * const allTools = getAIToolsWithBrowserConfig(AI_TOOLS);
 * // 返回的工具列表中，浏览器工具来自 BUILTIN_BROWSER_TOOLS
 */
export function getAIToolsWithBrowserConfig(baseTools: ToolDefinition[]): ToolDefinition[] {
  const BROWSER_TOOL_NAMES = new Set([
    'control_browser',
    'fetch_web_content',
    'browser',
    'fetch',
  ]);
  const filteredTools = baseTools.filter(
    (tool) => !BROWSER_TOOL_NAMES.has(tool.name)
  );

  // 始终使用内置浏览器工具
  return dedupeToolsByName([...filteredTools, ...BUILTIN_BROWSER_TOOLS]);
}
