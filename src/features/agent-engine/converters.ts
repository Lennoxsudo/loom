/**
 * 工具格式转换模块
 *
 * 本模块提供了将工具定义转换为不同 AI 提供商格式的功能：
 * - toAnthropicTools: 转换为 Anthropic Claude 格式
 * - toOpenAITools: 转换为 OpenAI 格式
 *
 * @module aiTools/converters
 */

import type { ToolDefinition } from '../../types/ai';

// Anthropic API 工具数量硬限制
const MAX_TOOLS = 128;

function truncateDescription(desc: string | undefined, maxLen: number): string | undefined {
  if (!desc) return desc;
  if (desc.length <= maxLen) return desc;
  return desc.slice(0, maxLen - 3) + '...';
}

const CORE_TOOL_NAMES = new Set(['read', 'finfo', 'search']);

function toolDescriptionLimit(toolName: string): number {
  return CORE_TOOL_NAMES.has(toolName) ? 180 : 100;
}

/**
 * 激进压缩 JSON Schema，大幅减少 token 消耗。
 * - depth=0 的 description 截断到 80 字符；depth>0 直接删除
 * - 仅保留核心字段：type, enum, required, properties, items
 * - 扁平化单元素 oneOf/anyOf/allOf
 */
function compactSchema(schema: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (schema.type) out.type = schema.type;
  if (depth === 0 && typeof schema.description === 'string') {
    out.description = truncateDescription(schema.description, 80);
  }
  if (schema.enum) out.enum = schema.enum;
  if (Array.isArray(schema.required) && schema.required.length > 0) out.required = schema.required;

  if (schema.properties && typeof schema.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (val && typeof val === 'object') {
        props[key] = compactSchema(val as Record<string, unknown>, depth + 1);
      } else {
        props[key] = val;
      }
    }
    out.properties = props;
  }

  if (schema.items && typeof schema.items === 'object') {
    out.items = compactSchema(schema.items as Record<string, unknown>, depth + 1);
  }

  const flattenComposite = (arr: unknown[]): unknown => {
    if (arr.length === 1 && arr[0] && typeof arr[0] === 'object') {
      return compactSchema(arr[0] as Record<string, unknown>, depth + 1);
    }
    return arr.map((s) => (s && typeof s === 'object' ? compactSchema(s as Record<string, unknown>, depth + 1) : s));
  };

  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    if (Array.isArray(schema[key])) {
      const result = flattenComposite(schema[key] as unknown[]);
      if (!Array.isArray(result)) {
        Object.assign(out, result);
      } else {
        out[key] = result;
      }
    }
  }

  return out;
}

/**
 * 安全地处理工具参数，确保它是有效的JSON Schema对象
 */
function safeProcessParameters(parameters: ToolDefinition['parameters']): Record<string, unknown> {
  // 如果参数已经是对象，直接使用
  if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
    return parameters as Record<string, unknown>;
  }
  
  // 如果参数是字符串，尝试解析为JSON
  if (typeof parameters === 'string') {
    try {
      const parsed = JSON.parse(parameters);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // 如果解析失败，返回默认的schema
    }
  }
  
  // 返回默认的schema
  return {
    type: 'object',
    properties: {},
    required: []
  };
}

function capTools(tools: ToolDefinition[], maxCount: number): ToolDefinition[] {
  if (tools.length <= maxCount) return tools;
  console.warn(`[Tools] 工具数量 ${tools.length} 超过上限 ${maxCount}，截取前 ${maxCount} 个`);
  return tools.slice(0, maxCount);
}

export function toAnthropicTools(tools: ToolDefinition[]) {
  return capTools(tools, MAX_TOOLS).map((tool) => {
    const safeParams = safeProcessParameters(tool.parameters);
    const schema = compactSchema(JSON.parse(JSON.stringify(safeParams)));

    if (Array.isArray(schema.required) && (schema.required as string[]).length === 0) {
      delete schema.required;
    }

    return {
      name: tool.name,
      description: truncateDescription(tool.description, toolDescriptionLimit(tool.name)),
      input_schema: schema,
    };
  });
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return capTools(tools, MAX_TOOLS).map((tool) => {
    const safeParams = safeProcessParameters(tool.parameters);
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: truncateDescription(tool.description, toolDescriptionLimit(tool.name)),
        parameters: compactSchema(JSON.parse(JSON.stringify(safeParams))),
      },
    };
  });
}
