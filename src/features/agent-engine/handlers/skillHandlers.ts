/**
 * Skill 工具处理器模块
 *
 * 提供 load_skill 工具的处理器实现。
 * LLM 根据 available_skills 索引判断需要某个 skill 时，
 * 调用 load_skill 获取完整指令内容。
 *
 * @module aiTools/handlers/skillHandlers
 */

import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { LoadSkillArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import { listSkillNames, loadSkillContent } from '../../../utils/skills';

const MAX_NAMES_IN_ERROR = 30;

/**
 * 加载 Skill 完整内容处理器
 */
class LoadSkillHandler implements ToolHandler<'skill'> {
  name = 'skill' as const;

  async execute(args: LoadSkillArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.skill_name || typeof args.skill_name !== 'string' || !args.skill_name.trim()) {
        throw ToolError.missingParam('skill_name');
      }

      const projectPath = context?.baseDir || '';
      const requested = args.skill_name.trim();
      const result = await loadSkillContent(requested, projectPath);

      if (!result) {
        const names = await listSkillNames(projectPath);
        const listed =
          names.length === 0
            ? '（当前无可用 skill）'
            : names.slice(0, MAX_NAMES_IN_ERROR).join(', ') +
              (names.length > MAX_NAMES_IN_ERROR
                ? ` …(+${names.length - MAX_NAMES_IN_ERROR})`
                : '');
        return {
          tool_call_id: '',
          output: '',
          error: `未找到名为 "${requested}" 的 skill。请使用 available_skills 中的精确 name 重试。可用: ${listed}`,
        };
      }

      const name = result.resolvedName;
      const scopeLabel = result.scope === 'project' ? '项目级' : '全局级';
      const output = [
        `<skill name="${name}" scope="${result.scope}">`,
        result.content,
        '</skill>',
        '',
        `[已加载 ${scopeLabel} skill "${name}"，请按照以上指令执行任务。]`,
      ].join('\n');

      return {
        tool_call_id: '',
        output,
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const skillHandlers: ToolHandler[] = [new LoadSkillHandler()];
