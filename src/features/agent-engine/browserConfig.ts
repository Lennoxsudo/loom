/**
 * 浏览器工具配置模块
 *
 * 将 browser / fetch / web_search 注入工具列表。
 * 当设置中启用 CDP 浏览器插件时，browser 工具暴露完整 CDP actions。
 */

import type { ToolDefinition } from '../../types/ai';
import { useSettingsStore } from '../../stores/useSettingsStore';

const PREVIEW_BROWSER_TOOL: ToolDefinition = {
  name: 'browser',
  description:
    'Control the built-in browser window. Available actions: ' +
    'open - open the built-in browser and navigate to a URL; ' +
    'navigate - navigate the browser to a new URL; ' +
    'refresh - refresh the current page. ' +
    'For click/type/screenshot/content (CDP), enable the CDP browser plugin in Settings → Plugins.',
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
};

const CDP_BROWSER_TOOL: ToolDefinition = {
  name: 'browser',
  description:
    'Control system Chrome/Edge via Loom CDP browser automation. Actions: ' +
    'open, close, navigate, refresh, click, type, press_key, content, evaluate, wait, screenshot. ' +
    'Use CSS selectors for click/type/wait. Prefer this for real DOM interaction and screenshots.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'open',
          'close',
          'navigate',
          'refresh',
          'click',
          'type',
          'press_key',
          'content',
          'evaluate',
          'wait',
          'screenshot',
        ],
        description: 'The browser action to perform.',
      },
      url: {
        type: 'string',
        description: 'URL for open/navigate. Ignored for other actions.',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for click, type, and wait actions.',
      },
      text: {
        type: 'string',
        description: 'Text to type into the element (type action).',
      },
      key: {
        type: 'string',
        description: 'Key to press (press_key), e.g. Enter, Tab, Escape, ArrowDown.',
      },
      clear: {
        type: 'boolean',
        description: 'When typing, clear the existing value first. Default false.',
      },
      expression: {
        type: 'string',
        description: 'JavaScript expression to evaluate in the page (evaluate action).',
      },
      timeout_ms: {
        type: 'number',
        description: 'Timeout in ms for wait action (default 10000, max 60000).',
      },
      full_page: {
        type: 'boolean',
        description: 'Capture full-page screenshot when action is screenshot.',
      },
      include_base64: {
        type: 'boolean',
        description: 'Include base64 PNG data in screenshot result (large). Default false.',
      },
    },
    required: ['action'],
  },
};

const FETCH_TOOL: ToolDefinition = {
  name: 'fetch',
  description:
    'Fetch web content and convert to Markdown. Supports custom HTTP methods (POST/PUT/DELETE/PATCH/HEAD), ' +
    'custom headers (Authorization, Cookie, etc.), request body for API testing, configurable timeout, ' +
    'redirect control, and link extraction. ' +
    'Non-200 responses still return body content when available (e.g., 404 pages with useful info). ' +
    'For SPA pages that require JavaScript rendering, use the browser tool instead. ' +
    'For discovering URLs by keyword, prefer web_search first.',
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
        description:
          'Custom request headers as key-value pairs. E.g., {"Authorization": "Bearer token", "Cookie": "session=abc"}',
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
        description:
          'Whether to extract and list all links from HTML pages. Default false. Useful for crawling multi-page content.',
      },
    },
    required: ['url'],
  },
};

const WEB_SEARCH_TOOL: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the public web and return lightweight results (title, URL, snippet) directly into context. ' +
    'Use this to discover sources for versions, APIs, error messages, docs, or current events. ' +
    'Unlike fetch (full page content) and browser (embedded UI), this only returns a short SERP list. ' +
    'After finding a relevant URL, call fetch to load the full page if needed.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query keywords. Be specific (e.g. "React 19 useEffect cleanup changelog").',
      },
      num_results: {
        type: 'number',
        description: 'Maximum number of results to return (1–10). Default is 5.',
      },
    },
    required: ['query'],
  },
};

function isCdpBrowserEnabled(): boolean {
  try {
    return Boolean(useSettingsStore.getState().enableCdpBrowser);
  } catch {
    return false;
  }
}

function browserToolDefinition(): ToolDefinition {
  return isCdpBrowserEnabled() ? CDP_BROWSER_TOOL : PREVIEW_BROWSER_TOOL;
}

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
 * 过滤基础列表中的 browser/fetch/web_search（及 legacy 别名），
 * 再注入当前配置下的内置实现。CDP 插件开启时 browser 含完整 actions。
 */
export function getAIToolsWithBrowserConfig(baseTools: ToolDefinition[]): ToolDefinition[] {
  const BROWSER_TOOL_NAMES = new Set([
    'control_browser',
    'fetch_web_content',
    'browser',
    'fetch',
    'web_search',
  ]);
  const filteredTools = baseTools.filter((tool) => !BROWSER_TOOL_NAMES.has(tool.name));

  return dedupeToolsByName([
    ...filteredTools,
    browserToolDefinition(),
    FETCH_TOOL,
    WEB_SEARCH_TOOL,
  ]);
}
