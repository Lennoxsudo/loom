/**
 * Image generation tool handler
 */

import { invoke } from '@tauri-apps/api/core';
import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { GenerateImageArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';

interface GenerateImageResponse {
  success: boolean;
  message: string;
  files: Array<{
    relativePath: string;
    absolutePath: string;
    size: number;
  }>;
}

class GenerateImageHandler implements ToolHandler<'generate_image'> {
  name = 'generate_image' as const;

  async execute(args: GenerateImageArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.prompt || typeof args.prompt !== 'string' || !args.prompt.trim()) {
        throw ToolError.missingParam('prompt');
      }

      const projectPath = context?.baseDir?.trim();
      if (!projectPath) {
        return {
          tool_call_id: '',
          output: '',
          error: '请先打开项目工作区后再生成图片。',
        };
      }

      const result = await invoke<GenerateImageResponse>('generate_image', {
        request: {
          prompt: args.prompt.trim(),
          projectPath,
          model: args.model,
          size: args.size,
          quality: args.quality,
          n: args.n,
        },
      });

      if (!result.success) {
        return {
          tool_call_id: '',
          output: '',
          error: result.message || '图片生成失败',
        };
      }

      const lines = [
        result.message,
        ...result.files.map(
          (file) => `- ${file.relativePath} (${file.size} bytes)\n  absolute: ${file.absolutePath}`
        ),
      ];

      return {
        tool_call_id: '',
        output: lines.join('\n'),
        files_changed: result.files.map((file) => file.relativePath),
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const imageGenHandlers: ToolHandler[] = [new GenerateImageHandler()];
