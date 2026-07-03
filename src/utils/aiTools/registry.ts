/**
 * 工具处理器注册表
 * 
 * 本模块提供了工具处理器的注册和查找功能。
 * 所有工具处理器都应该通过此模块进行注册。
 * 
 * @module aiTools/registry
 */

import type { ToolHandler } from './types';
import type { ToolName } from './toolArgs';
import { fileHandlers } from './handlers/fileHandlersRuntime';
import { searchHandlers } from './handlers/searchHandlers';
import { terminalHandlers } from './handlers/terminalHandlers';
import { gitHandlers } from './handlers/gitHandlers';
import { browserHandlers } from './handlers/browserHandlers';
import { fileOperationHandlers } from './handlers/fileOperationHandlers';
import { planningHandlers } from './handlers/planningHandlers';
import { interactionHandlers } from './handlers/interactionHandlers';
import { skillHandlers } from './handlers/skillHandlers';
import { imageGenHandlers } from './handlers/imageGenHandlers';
import { subagentHandlers } from './handlers/subagentHandlers';
import { agentToolHandlers } from './handlers/agentToolHandler';
import { graphHandlers } from './handlers/graphHandlers';


const toolHandlers = new Map<ToolName, ToolHandler>();

/**
 * 注册单个工具处理器
 * 
 * @param handler - 要注册的处理器实例
 */
function registerHandler<T extends ToolName>(handler: ToolHandler<T>): void {
  toolHandlers.set(handler.name, handler);
}

/**
 * 批量注册工具处理器
 * 
 * @param handlers - 处理器实例数组
 */
function registerHandlers(handlers: ToolHandler[]): void {
  for (const handler of handlers) {
    registerHandler(handler);
  }
}

// 自动注册所有内置处理器
registerHandlers(fileHandlers);
registerHandlers(searchHandlers);
registerHandlers(terminalHandlers);
registerHandlers(gitHandlers);
registerHandlers(browserHandlers);
registerHandlers(fileOperationHandlers);
registerHandlers(planningHandlers);
registerHandlers(interactionHandlers);
registerHandlers(skillHandlers);
registerHandlers(imageGenHandlers);
registerHandlers(subagentHandlers);
registerHandlers(agentToolHandlers);
registerHandlers(graphHandlers);


// Register legacy name aliases for backward compatibility
// When the model or stored conversations use old names, route them to the same handler
const LEGACY_ALIASES: Array<{ alias: string; canonical: string }> = [
  { alias: 'read_file', canonical: 'read' },
  { alias: 'write_file', canonical: 'write' },
  { alias: 'edit_file', canonical: 'edit' },
  { alias: 'get_symbol_definition', canonical: 'sym' },
  { alias: 'TodoWrite', canonical: 'todo' },
  { alias: 'ask_user_question', canonical: 'ask' },
  { alias: 'fetch_web_content', canonical: 'fetch' },
  { alias: 'control_browser', canonical: 'browser' },
  { alias: 'load_skill', canonical: 'skill' },
];

for (const { alias, canonical } of LEGACY_ALIASES) {
  const handler = toolHandlers.get(canonical as ToolName);
  if (handler) {
    toolHandlers.set(alias as ToolName, handler);
  }
}

/**
 * 获取指定工具的处理器
 * 
 * @typeParam T - 工具名称类型
 * @param name - 工具名称
 * @returns 处理器实例，如果未找到则返回 undefined
 * 
 * @example
 * ```typescript
 * const handler = getToolHandler('read_file');
 * if (handler) {
 *   const result = await handler.execute({ path: '/test/file.txt' });
 * }
 * ```
 */
export function getToolHandler<T extends ToolName>(name: T): ToolHandler<T> | undefined {
  return toolHandlers.get(name) as ToolHandler<T> | undefined;
}

/**
 * 检查指定工具是否有注册的处理器
 * 
 * @param name - 工具名称
 * @returns 如果处理器存在返回 true
 */
export function hasToolHandler(name: ToolName): boolean {
  return toolHandlers.has(name);
}
