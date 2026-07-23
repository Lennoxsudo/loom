import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { AskUserQuestionArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';

/**
 * 验证问题选项
 */
function validateOptions(options: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(options)) {
    return { valid: false, error: 'options 必须是数组' };
  }
  if (options.length < 2 || options.length > 4) {
    return { valid: false, error: '每个问题需要 2-4 个选项' };
  }
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt || typeof opt !== 'object') {
      return { valid: false, error: `options[${i}] 必须是对象` };
    }
    if (typeof opt.label !== 'string' || opt.label.trim().length === 0) {
      return { valid: false, error: `options[${i}].label 必须是非空字符串` };
    }
    if (typeof opt.description !== 'string' || opt.description.trim().length === 0) {
      return { valid: false, error: `options[${i}].description 必须是非空字符串` };
    }
  }
  return { valid: true };
}

/**
 * 向用户提问工具处理器
 */
class AskUserQuestionHandler implements ToolHandler<'ask'> {
  name = 'ask' as const;

  async execute(args: AskUserQuestionArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      // 验证 questions 参数
      if (!Array.isArray(args.questions)) {
        throw ToolError.missingParam('questions');
      }
      if (args.questions.length === 0) {
        throw ToolError.invalidParam('questions', '至少需要一个问题');
      }
      if (args.questions.length > 4) {
        throw ToolError.invalidParam('questions', '最多支持4个问题');
      }

      // 验证每个问题
      const warnings: Array<{
        field: string;
        original_value: string;
        original_length: number;
        max_length: number;
        applied_value: string;
      }> = [];
      for (let i = 0; i < args.questions.length; i++) {
        const q = args.questions[i];
        if (!q || typeof q !== 'object') {
          throw ToolError.invalidParam(`questions[${i}]`, '必须是对象');
        }
        if (typeof q.header !== 'string' || q.header.trim().length === 0) {
          throw ToolError.invalidParam(`questions[${i}].header`, '必须是非空字符串');
        }
        // 自动截断超长的 header，记录 warning
        if (q.header.length > 12) {
          const original = q.header;
          q.header = q.header.slice(0, 12);
          warnings.push({
            field: `questions[${i}].header`,
            original_value: original,
            original_length: original.length,
            max_length: 12,
            applied_value: q.header,
          });
        }
        if (typeof q.question !== 'string' || q.question.trim().length === 0) {
          throw ToolError.invalidParam(`questions[${i}].question`, '必须是非空字符串');
        }

        const optionsValidation = validateOptions(q.options);
        if (!optionsValidation.valid) {
          throw ToolError.invalidParam(
            `questions[${i}].options`,
            optionsValidation.error || '无效'
          );
        }
      }

      // 检查是否有回调函数
      if (!context?.onAskUserQuestion) {
        return {
          tool_call_id: '',
          output: '',
          error: 'ask_user_question 工具未在此环境中支持',
        };
      }

      // 调用回调函数向用户提问
      const answers = await context.onAskUserQuestion(context.agentId || '', args.questions);

      // 格式化输出
      const outputLines = ['用户已回答问题：'];
      for (let i = 0; i < args.questions.length; i++) {
        const q = args.questions[i];
        const answer = answers.find((a) => a.questionIndex === i);
        if (answer) {
          outputLines.push(`\n问题 ${i + 1} [${q.header}]: ${q.question}`);
          outputLines.push(`回答: ${answer.selected.join(', ')}`);
        }
      }
      if (warnings.length > 0) {
        outputLines.push('\n⚠️ warnings:');
        outputLines.push(JSON.stringify(warnings));
        outputLines.push(
          '提示：header 最多12字符，建议使用2-6字的简短标签如"框架"、"样式"、"部署"'
        );
      }

      return {
        tool_call_id: '',
        output: outputLines.join('\n'),
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const interactionHandlers: ToolHandler[] = [new AskUserQuestionHandler()];
