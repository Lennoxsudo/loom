/**
 * MCP (Model Context Protocol) 客户端
 *
 * 支持多服务器并行运行，按 server_id 路由工具调用
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// 递归属性 schema 类型（与后端 McpPropertySchema 对应）
interface McpPropSchema {
  type: string;
  description?: string | null;
  enum_values?: unknown[] | null;
  default?: unknown | null;
  items?: McpPropSchema | null;
  properties?: Record<string, McpPropSchema> | null;
  required?: string[] | null;
  // 高级 JSON Schema
  oneOf?: McpPropSchema[] | null;
  anyOf?: McpPropSchema[] | null;
  allOf?: McpPropSchema[] | null;
  $ref?: string | null;
  pattern?: string | null;
  format?: string | null;
  minimum?: number | null;
  maximum?: number | null;
  additionalProperties?: unknown | null;
}

/**
 * 递归将后端返回的 McpPropSchema 转换为标准 JSON Schema 格式
 */
function mapPropToJsonSchema(prop: McpPropSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // 仅当 type 非空时才设置，避免破坏 oneOf/anyOf 等联合类型 schema
  if (prop.type) out.type = prop.type;
  if (prop.description) out.description = prop.description;
  if (prop.enum_values) out.enum = prop.enum_values;
  if (prop.default !== null && prop.default !== undefined) out.default = prop.default;
  if (prop.items) out.items = mapPropToJsonSchema(prop.items);
  if (prop.properties) {
    const nested: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(prop.properties)) {
      nested[k] = mapPropToJsonSchema(v);
    }
    out.properties = nested;
  }
  if (prop.required && prop.required.length > 0) out.required = prop.required;
  // 高级 JSON Schema
  if (prop.oneOf) out.oneOf = prop.oneOf.map(mapPropToJsonSchema);
  if (prop.anyOf) out.anyOf = prop.anyOf.map(mapPropToJsonSchema);
  if (prop.allOf) out.allOf = prop.allOf.map(mapPropToJsonSchema);
  if (prop.$ref) out.$ref = prop.$ref;
  if (prop.pattern) out.pattern = prop.pattern;
  if (prop.format) out.format = prop.format;
  if (prop.minimum !== null && prop.minimum !== undefined) out.minimum = prop.minimum;
  if (prop.maximum !== null && prop.maximum !== undefined) out.maximum = prop.maximum;
  if (prop.additionalProperties !== null && prop.additionalProperties !== undefined)
    out.additionalProperties = prop.additionalProperties;
  return out;
}

// MCP 工具信息（带 serverId）
export interface McpToolInfo {
  name: string;
  description: string | null;
  server_id: string;
}

// MCP 工具调用结果
interface McpToolResult {
  success: boolean;
  content: unknown | null;
  /** 结构化解析后的内容项（文本、图片、资源） */
  content_items?: McpContentItem[] | null;
  /** MCP 层面 isError 标记 */
  is_error?: boolean;
  error: string | null;
}

// MCP 内容项类型
interface McpContentItem {
  type: 'text' | 'image' | 'resource';
  /** 文本内容（type=text 时） */
  text?: string;
  /** Base64 图片数据（type=image 时） */
  data?: string;
  /** 图片 MIME 类型（type=image 时） */
  mimeType?: string;
  /** Base64 数据长度（type=image 时） */
  data_len?: number;
  /** 资源对象（type=resource 时） */
  resource?: unknown;
}

// 单个 MCP 服务器状态
export interface McpServerStatusEntry {
  server_id: string;
  server_name: string;
  is_running: boolean;
  is_initialized: boolean;
}

// MCP 资源
interface McpResource {
  uri: string;
  name: string;
  description?: string | null;
  mimeType?: string | null;
  server_id: string;
}

// MCP 资源内容
interface McpResourceContent {
  uri: string;
  mimeType?: string | null;
  text?: string | null;
  blob?: string | null;
}

// MCP 提示词模板
interface McpPromptInfo {
  name: string;
  description?: string | null;
  arguments?: McpPromptArgument[] | null;
  server_id: string;
}

// MCP 提示词参数
interface McpPromptArgument {
  name: string;
  description?: string | null;
  required?: boolean | null;
}

/**
 * MCP 客户端类 — 多服务器支持
 */
class McpClient {
  private static instance: McpClient;
  private toolsCache: McpToolInfo[] | null = null;
  /** 按 serverId 分组的串行队列，不同服务器之间可并行 */
  private serverQueues: Map<string, Promise<void>> = new Map();
  private toolsInvalidatedListeners: Set<() => void> = new Set();

  private constructor() {
    // 监听后台 MCP 服务器启动完成事件，自动刷新工具缓存
    listen<{ server_id: string; server_name: string; success: boolean; error?: string }>(
      'mcp-server-started',
      (event) => {
        const { server_id, server_name, success, error } = event.payload;
        if (success) {
          console.warn(`[MCP] Server '${server_name}' (${server_id}) started successfully`);
          this.toolsCache = null; // 清除缓存，下次 listTools 会重新获取
          this.notifyToolsInvalidated();
        } else {
          console.warn(`[MCP] Server '${server_name}' (${server_id}) failed to start:`, error);
        }
      }
    );
  }

  static getInstance(): McpClient {
    if (!McpClient.instance) {
      McpClient.instance = new McpClient();
    }
    return McpClient.instance;
  }

  /**
   * 启动所有已启用的 MCP 服务器
   */
  async start(): Promise<void> {
    await this.enqueue('__global__', async () => {
      await invoke('start_mcp_server');
      this.toolsCache = null;
      this.notifyToolsInvalidated();
    });
  }

  /**
   * 异步启动所有已启用的 MCP 服务器（fire-and-forget，不阻塞 UI）
   * 每个服务器在后台独立启动，启动完成后通过事件通知前端
   */
  async startAsync(): Promise<number> {
    const count = await invoke<number>('start_mcp_servers_async');
    this.toolsCache = null;
    this.notifyToolsInvalidated();
    return count;
  }

  /**
   * 停止所有 MCP 服务器
   */
  async stop(): Promise<void> {
    await this.enqueue('__global__', async () => {
      await invoke('stop_mcp_server');
      this.toolsCache = null;
      this.notifyToolsInvalidated();
    });
  }

  /**
   * 启动单个 MCP 服务器
   */
  async startServer(serverId: string): Promise<void> {
    await this.enqueue(serverId, async () => {
      await invoke('start_single_mcp', { serverId });
      this.toolsCache = null;
      this.notifyToolsInvalidated();
    });
  }

  /**
   * 停止单个 MCP 服务器
   */
  async stopServer(serverId: string): Promise<void> {
    await this.enqueue(serverId, async () => {
      await invoke('stop_single_mcp', { serverId });
      this.toolsCache = null;
      this.notifyToolsInvalidated();
    });
  }

  /**
   * 获取所有 MCP 服务器状态
   */
  async getStatus(): Promise<McpServerStatusEntry[]> {
    return await invoke('get_mcp_status');
  }

  /**
   * 获取所有运行中服务器的可用工具列表
   */
  async listTools(): Promise<McpToolInfo[]> {
    return await this.enqueue('__global__', async () => {
      if (this.toolsCache) {
        return this.toolsCache;
      }

      const tools = await invoke<McpToolInfo[]>('list_mcp_tools');
      this.toolsCache = tools;
      return tools;
    });
  }

  /**
   * 调用 MCP 工具（路由到指定服务器）
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<McpToolResult> {
    return this.enqueue(serverId, async () => {
      const timeoutMs = this.getTimeoutMs(toolName);
      const invokePromise = invoke<McpToolResult>('call_mcp_tool', {
        serverId,
        toolName,
        arguments: args,
      });

      const result = await this.withTimeout(
        invokePromise,
        timeoutMs,
        `调用 MCP 工具超时: ${serverId}/${toolName} (${timeoutMs}ms)`
      );

      if (!result.success) {
        console.error(`[MCP Client] Tool ${serverId}/${toolName} failed:`, result.error);
      }

      return result;
    });
  }

  // ============================================================
  // Resources 支持
  // ============================================================

  /**
   * 获取所有运行中服务器的资源列表
   */
  async listResources(): Promise<McpResource[]> {
    return await this.enqueue('__global__', async () => {
      return await invoke<McpResource[]>('list_mcp_resources');
    });
  }

  /**
   * 读取指定服务器上的资源内容
   */
  async readResource(serverId: string, uri: string): Promise<McpResourceContent[]> {
    return await this.enqueue(serverId, async () => {
      return await invoke<McpResourceContent[]>('read_mcp_resource', {
        serverId,
        uri,
      });
    });
  }

  // ============================================================
  // Prompts 支持
  // ============================================================

  /**
   * 获取所有运行中服务器的提示词模板列表
   */
  async listPrompts(): Promise<McpPromptInfo[]> {
    return await this.enqueue('__global__', async () => {
      return await invoke<McpPromptInfo[]>('list_mcp_prompts');
    });
  }

  /**
   * 获取指定服务器上的提示词模板内容
   */
  async getPrompt(
    serverId: string,
    name: string,
    args: Record<string, string> = {}
  ): Promise<unknown> {
    return await this.enqueue(serverId, async () => {
      return await invoke('get_mcp_prompt', {
        serverId,
        name,
        arguments: args,
      });
    });
  }

  /**
   * 根据工具名称关键词确定超时等级
   */
  private getTimeoutMs(toolName: string): number {
    const name = toolName.toLowerCase();
    // 截图/图片类工具 — 90 秒
    if (
      name.includes('screenshot') ||
      name.includes('snapshot') ||
      name.includes('image') ||
      name.includes('capture')
    ) {
      return 90_000;
    }
    // 长时间运行工具（执行、生成、分析、搜索等）— 120 秒
    if (
      name.includes('execute') ||
      name.includes('run') ||
      name.includes('eval') ||
      name.includes('generate') ||
      name.includes('analyze') ||
      name.includes('search') ||
      name.includes('think') ||
      name.includes('reason')
    ) {
      return 120_000;
    }
    // 默认 — 60 秒
    return 60_000;
  }

  /**
   * 按队列 key 串行执行。
   * - 同一 key（通常是 serverId）的调用串行执行，防止对同一服务器的并发竞争。
   * - 不同 key 的调用可以并行执行。
   * - '__global__' 是特殊 key，会等待所有现有队列先完成，用于跨服务器操作。
   */
  private async enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (key === '__global__') {
      // 全局操作：等待所有现有服务器队列完成
      const allPrev = Array.from(this.serverQueues.values());
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      // 将 gate 注入所有现有队列，阻塞后续同服务器调用直到全局操作完成
      for (const queueKey of this.serverQueues.keys()) {
        this.serverQueues.set(queueKey, gate.then());
      }
      await Promise.all(allPrev);
      try {
        return await fn();
      } finally {
        release();
      }
    }

    const prev = this.serverQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.serverQueues.set(key, gate);

    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async withTimeout(
    promise: Promise<McpToolResult>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<McpToolResult> {
    let timer: number | null = null;

    try {
      const timeoutPromise = new Promise<McpToolResult>((resolve) => {
        timer = window.setTimeout(() => {
          resolve({ success: false, content: null, error: timeoutMessage });
        }, timeoutMs);
      });

      return (await Promise.race([promise, timeoutPromise])) as McpToolResult;
    } finally {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    }
  }

  /**
   * 确保至少有一个 MCP 服务器已启动
   */
  async ensureStarted(): Promise<boolean> {
    const statuses = await this.getStatus();
    const hasRunning = statuses.some((s) => s.is_running && s.is_initialized);

    if (!hasRunning) {
      try {
        await this.start();
        return true;
      } catch (err) {
        console.error('[MCP Client] Failed to start MCP servers:', err);
        return false;
      }
    }
    return true;
  }

  /**
   * 生成工具定义（用于 AI）
   * 工具名格式: mcp_<serverId>__<toolName>
   */
  async getToolDefinitions(): Promise<
    Array<{
      type: string;
      function: {
        name: string;
        description: string;
        parameters: {
          type: string;
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    }>
  > {
    // 调用后端获取完整的工具 schema（包含 inputSchema）
    type SchemaResult = {
      success: boolean;
      schemas: Array<{
        name: string;
        description: string | null;
        input_schema: {
          type: string;
          properties: Record<string, McpPropSchema>;
          required: string[] | null;
        };
        server_id: string | null;
      }>;
      error: string | null;
    };

    try {
      const result = await invoke<SchemaResult>('get_mcp_tool_schemas');

      if (!result.success || !result.schemas.length) {
        // Fallback: 使用 listTools 返回基本信息
        const tools = await this.listTools();
        return tools.map((tool) => ({
          type: 'function',
          function: {
            name: `mcp_${tool.server_id}__${tool.name}`,
            description: tool.description || `MCP 工具: ${tool.name}`,
            parameters: { type: 'object', properties: {}, required: [] },
          },
        }));
      }

      return result.schemas.map((schema) => {
        const properties: Record<string, unknown> = {};
        const required: string[] = schema.input_schema.required || [];

        for (const [key, prop] of Object.entries(schema.input_schema.properties)) {
          properties[key] = mapPropToJsonSchema(prop);
        }

        return {
          type: 'function',
          function: {
            name: `mcp_${schema.server_id || 'unknown'}__${schema.name}`,
            description: schema.description || `MCP 工具: ${schema.name}`,
            parameters: {
              type: 'object',
              properties,
              required,
            },
          },
        };
      });
    } catch (error) {
      console.error('[MCP Client] Failed to get tool schemas:', error);
      return [];
    }
  }

  /**
   * 清除工具缓存
   */
  clearToolsCache(): void {
    this.toolsCache = null;
  }

  onToolsInvalidated(listener: () => void): () => void {
    this.toolsInvalidatedListeners.add(listener);
    return () => {
      this.toolsInvalidatedListeners.delete(listener);
    };
  }

  private notifyToolsInvalidated(): void {
    for (const listener of this.toolsInvalidatedListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[MCP] tools invalidated listener failed:', error);
      }
    }
  }
}

// 导出单例
export const mcpClient = McpClient.getInstance();
