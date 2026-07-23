/**
 * AI 工具系统类型定义
 *
 * 本模块定义了工具处理器所需的核心类型：
 * - `ToolContext`: 工具执行上下文
 * - `ToolHandler`: 工具处理器接口
 *
 * @module aiTools/types
 */

import type { ToolResult } from '../../types/ai';
import type { AIProvider } from '../../utils/agentPersistence';

import type { ToolName, GetToolArgs } from './toolArgs';
import type { EngineHostCallbacks } from './events';

/**
 * 工具执行上下文
 *
 * 提供工具执行时所需的环境信息。
 * UI 宿主通过回调注入（见 {@link EngineHostCallbacks}），引擎不依赖 React 组件。
 */
export interface ToolContext extends EngineHostCallbacks {
  /** 当前工作目录的基础路径 */
  baseDir?: string;
  /** 当前 Agent ID */
  agentId?: string;
  /** 当前会话 ID（用于会话隔离，如 Todo 清单） */
  conversationId?: string;
  /** 当前工具调用的 ID（用于关联子代理任务 taskId 等） */
  toolCallId?: string;
  /** 父级（主聊天）当前的 AI 服务商，子代理用于继承模型 */
  parentProvider?: AIProvider;
  /** 父级（主聊天）当前的模型 ID，子代理用于继承模型 */
  parentModel?: string;
  /** Agent 绑定的 AI profile，子代理继承以使用同一中转端点 */
  profileId?: string;
  /** 当前 Agent 的上下文窗口大小（token），用于 MCP 输出动态预算 */
  maxContextTokens?: number;
  /** 子代理嵌套深度（0 = 主代理直接 spawn） */
  subagentDepth?: number;
  /** 子代理 spawn 模式 */
  spawnMode?: 'isolated' | 'fork';
  /** Fork 模式：父会话消息快照 */
  parentMessages?: import('../../types/chat').ChatMessage[];
  /** 父会话可用工具名（含 MCP） */
  parentToolNames?: string[];
  /** 父会话 MCP 工具定义 */
  parentMcpTools?: import('../../types/ai').ToolDefinition[];
  /** 子代理局部访问档位（覆盖全局 agentAccessMode） */
  subagentPermissionMode?: import('../../types/settings').AgentAccessMode;
  /** 允许 spawn 的子代理类型白名单 */
  allowedSubagentTypes?: string[];
  /** 当前子代理任务 ID（嵌套 spawn 时作为 parentTaskId） */
  spawnParentTaskId?: string;
}

/**
 * 工具处理器接口
 *
 * 定义所有工具处理器必须实现的标准接口。
 * 使用泛型 `TName` 可确保参数类型与工具名严格对应。
 *
 * @typeParam TName - 工具名类型，必须是 `ToolName` 的子类型
 *
 * @example
 * ```typescript
 * class ReadFileHandler implements ToolHandler<'read_file'> {
 *   name = 'read_file' as const;
 *
 *   async execute(args: ReadFileArgs, context?: ToolContext): Promise<ToolResult> {
 *     // 实现读取文件逻辑
 *   }
 * }
 * ```
 */
export interface ToolHandler<TName extends ToolName = ToolName> {
  /** 工具名称 */
  name: TName;

  /**
   * 执行工具
   *
   * @param args - 工具参数，类型由 `TName` 决定
   * @param context - 执行上下文
   * @returns 工具执行结果
   */
  execute(args: GetToolArgs<TName>, context?: ToolContext): Promise<ToolResult>;

  /**
   * 验证参数类型
   *
   * @param args - 待验证的参数
   * @returns 如果参数有效则返回 `true`
   */
  validate?(args: unknown): args is GetToolArgs<TName>;
}
