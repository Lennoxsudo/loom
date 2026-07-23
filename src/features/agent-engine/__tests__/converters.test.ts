/**
 * 格式转换器测试 (converters.ts)
 *
 * 测试 toAnthropicTools / toOpenAITools:
 * - 基本结构正确性
 * - 空输入 / 边界值
 * - description 截断
 * - Schema 压缩 (compactSchema)
 * - 工具数量上限 (MAX_TOOLS)
 * - safeProcessParameters 容错
 */

import { describe, it, expect } from 'vitest';
import { toAnthropicTools, toOpenAITools } from '../converters';
import type { ToolDefinition } from '../../../types/ai';

// ============================================================================
// 测试辅助：构造 ToolDefinition
// ============================================================================

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'A test tool for unit testing',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        max_lines: { type: 'number', description: 'Maximum lines to read' },
      },
      required: ['path'],
    },
    ...overrides,
  };
}

function makeNestedSchemaTool(): ToolDefinition {
  return {
    name: 'nested_tool',
    description: 'Tool with nested schema',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'close', 'run'],
          description: 'Action to perform',
        },
        config: {
          type: 'object',
          properties: {
            timeout: { type: 'number', description: 'Timeout in ms' },
            retry: { type: 'boolean', description: 'Whether to retry' },
          },
          required: ['timeout'],
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Item ID' },
              count: { type: 'number', description: 'Item count' },
            },
            required: ['id'],
          },
        },
      },
      required: ['action'],
    },
  };
}

// ============================================================================
// toAnthropicTools
// ============================================================================

describe('toAnthropicTools', () => {
  describe('基本结构', () => {
    it('返回数组', () => {
      const result = toAnthropicTools([makeTool()]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('每个工具包含 name, description, input_schema', () => {
      const result = toAnthropicTools([makeTool()]);
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('input_schema');
    });

    it('name 与原始工具一致', () => {
      const result = toAnthropicTools([makeTool({ name: 'my_custom_tool' })]);
      expect(result[0].name).toBe('my_custom_tool');
    });

    it('input_schema 包含 type, properties, required', () => {
      const result = toAnthropicTools([makeTool()]);
      const schema = result[0].input_schema as Record<string, unknown>;
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
      expect(schema.required).toEqual(['path']);
    });

    it('空的 required 数组被删除', () => {
      const tool = makeTool({
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: [],
        },
      });
      const result = toAnthropicTools([tool]);
      const schema = result[0].input_schema as Record<string, unknown>;
      expect(schema.required).toBeUndefined();
    });
  });

  describe('空输入', () => {
    it('空数组返回空数组', () => {
      const result = toAnthropicTools([]);
      expect(result).toEqual([]);
    });
  });

  describe('description 截断', () => {
    it('超过 100 字符的 description 被截断', () => {
      const longDesc = 'A'.repeat(150);
      const result = toAnthropicTools([makeTool({ description: longDesc })]);
      expect(result[0].description!.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(result[0].description!.endsWith('...')).toBe(true);
    });

    it('100 字符以内的 description 不被截断', () => {
      const shortDesc = 'A short description';
      const result = toAnthropicTools([makeTool({ description: shortDesc })]);
      expect(result[0].description).toBe(shortDesc);
    });

    it('恰好 100 字符的 description 不被截断', () => {
      const exactDesc = 'A'.repeat(100);
      const result = toAnthropicTools([makeTool({ description: exactDesc })]);
      expect(result[0].description).toBe(exactDesc);
    });
  });

  describe('Schema 压缩', () => {
    it('嵌套 schema 被正确压缩', () => {
      const result = toAnthropicTools([makeNestedSchemaTool()]);
      const schema = result[0].input_schema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;

      // action 字段保留 type, enum
      const action = props.action as Record<string, unknown>;
      expect(action.type).toBe('string');
      expect(action.enum).toEqual(['create', 'close', 'run']);
      // depth>0 的 description 被删除
      expect(action.description).toBeUndefined();

      // config 嵌套对象被压缩
      const config = props.config as Record<string, unknown>;
      expect(config.type).toBe('object');
      const configProps = config.properties as Record<string, unknown>;
      const timeout = configProps.timeout as Record<string, unknown>;
      expect(timeout.type).toBe('number');
      expect(timeout.description).toBeUndefined(); // depth>0

      // items 数组的 items 被压缩
      const items = props.items as Record<string, unknown>;
      expect(items.type).toBe('array');
    });

    it('depth=0 的 description 被截断到 80 字符', () => {
      // compactSchema 在 depth=0 时截断 description 到 80 字符。
      // 顶层 parameters 是 depth=0，所以 parameters 自身的 description（如有）会被截断。
      // 但 properties 内的字段 depth>0，其 description 会被删除。
      // 这里验证：parameters 顶层有 description 时会被截断。
      const tool: ToolDefinition = {
        name: 'desc_test',
        description: 'Test description truncation',
        parameters: {
          type: 'object',
          properties: {
            data: { type: 'string' },
          },
          required: [],
          // 给 parameters 自身加 description（通过 as 绕过类型检查）
          ...({ description: 'B'.repeat(120) } as Record<string, unknown>),
        } as ToolDefinition['parameters'],
      };
      const result = toAnthropicTools([tool]);
      const schema = result[0].input_schema as Record<string, unknown>;

      // depth=0 的 description 被截断
      expect(schema.description).toBeDefined();
      expect((schema.description as string).length).toBeLessThanOrEqual(83); // 80 + '...'
      // depth>0 的字段 description 被删除
      const props = schema.properties as Record<string, unknown>;
      const data = props.data as Record<string, unknown>;
      expect(data.description).toBeUndefined();
    });

    it('单元素 oneOf/anyOf/allOf 被扁平化', () => {
      const tool: ToolDefinition = {
        name: 'composite_test',
        description: 'Test composite schema flattening',
        parameters: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              oneOf: [{ type: 'string', description: 'A string value' }],
              description: 'Value field',
            },
          },
          required: [],
        },
      };
      const result = toAnthropicTools([tool]);
      const schema = result[0].input_schema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      const value = props.value as Record<string, unknown>;

      // 单元素 oneOf 被扁平化：type 和 description 直接出现在 value 上
      expect(value.type).toBe('string');
      // oneOf 不应该再存在
      expect(value.oneOf).toBeUndefined();
    });

    it('多元素 oneOf 保留数组结构', () => {
      const tool: ToolDefinition = {
        name: 'multi_composite_test',
        description: 'Test multi-element composite',
        parameters: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              oneOf: [
                { type: 'string', description: 'String variant' },
                { type: 'number', description: 'Number variant' },
              ],
              description: 'Value field',
            },
          },
          required: [],
        },
      };
      const result = toAnthropicTools([tool]);
      const schema = result[0].input_schema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      const value = props.value as Record<string, unknown>;

      // 多元素保留数组
      expect(Array.isArray(value.oneOf)).toBe(true);
      expect((value.oneOf as unknown[]).length).toBe(2);
    });
  });

  describe('safeProcessParameters 容错', () => {
    it('parameters 为字符串时回退到默认 schema', () => {
      const tool = {
        name: 'bad_params',
        description: 'Tool with string params',
        parameters: 'not an object',
      } as unknown as ToolDefinition;

      const result = toAnthropicTools([tool]);
      const schema = result[0].input_schema as Record<string, unknown>;
      expect(schema.type).toBe('object');
      expect(schema.properties).toEqual({});
      // compactSchema 只在 required.length > 0 时才设置 required 字段
      // 默认 schema 的 required 是 []，所以不会出现在输出中
      expect(schema.required).toBeUndefined();
    });

    it('parameters 为 null 时回退到默认 schema', () => {
      const tool = {
        name: 'null_params',
        description: 'Tool with null params',
        parameters: null,
      } as unknown as ToolDefinition;

      const result = toAnthropicTools([tool]);
      const schema = result[0].input_schema as Record<string, unknown>;
      expect(schema.type).toBe('object');
    });

    it('parameters 为数组时回退到默认 schema', () => {
      const tool = {
        name: 'array_params',
        description: 'Tool with array params',
        parameters: [1, 2, 3],
      } as unknown as ToolDefinition;

      const result = toAnthropicTools([tool]);
      const schema = result[0].input_schema as Record<string, unknown>;
      expect(schema.type).toBe('object');
    });

    it('parameters 为合法 JSON 字符串时正确解析', () => {
      const tool = {
        name: 'json_string_params',
        description: 'Tool with JSON string params',
        parameters: JSON.stringify({
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        }),
      } as unknown as ToolDefinition;

      const result = toAnthropicTools([tool]);
      const schema = result[0].input_schema as Record<string, unknown>;
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
      expect(schema.required).toEqual(['path']);
    });
  });

  describe('工具数量上限', () => {
    it('超过 128 个工具时截取前 128 个', () => {
      const tools = Array.from({ length: 150 }, (_, i) => makeTool({ name: `tool_${i}` }));
      const result = toAnthropicTools(tools);
      expect(result.length).toBe(128);
      expect(result[0].name).toBe('tool_0');
      expect(result[127].name).toBe('tool_127');
    });

    it('恰好 128 个工具时全部保留', () => {
      const tools = Array.from({ length: 128 }, (_, i) => makeTool({ name: `tool_${i}` }));
      const result = toAnthropicTools(tools);
      expect(result.length).toBe(128);
    });
  });
});

// ============================================================================
// toOpenAITools
// ============================================================================

describe('toOpenAITools', () => {
  describe('基本结构', () => {
    it('返回数组', () => {
      const result = toOpenAITools([makeTool()]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('每个工具包含 type 和 function', () => {
      const result = toOpenAITools([makeTool()]);
      expect(result[0].type).toBe('function');
      expect(result[0].function).toBeDefined();
    });

    it('function 包含 name, description, parameters', () => {
      const result = toOpenAITools([makeTool()]);
      const fn = result[0].function;
      expect(fn.name).toBe('test_tool');
      expect(fn.description).toBeDefined();
      expect(fn.parameters).toBeDefined();
    });

    it('parameters 是压缩后的 schema', () => {
      const result = toOpenAITools([makeTool()]);
      const params = result[0].function.parameters as Record<string, unknown>;
      expect(params.type).toBe('object');
      expect(params.properties).toBeDefined();
    });
  });

  describe('空输入', () => {
    it('空数组返回空数组', () => {
      const result = toOpenAITools([]);
      expect(result).toEqual([]);
    });
  });

  describe('description 截断', () => {
    it('超过 100 字符的 description 被截断', () => {
      const longDesc = 'X'.repeat(200);
      const result = toOpenAITools([makeTool({ description: longDesc })]);
      expect(result[0].function.description!.length).toBeLessThanOrEqual(103);
    });
  });

  describe('工具数量上限', () => {
    it('超过 128 个工具时截取前 128 个', () => {
      const tools = Array.from({ length: 200 }, (_, i) => makeTool({ name: `tool_${i}` }));
      const result = toOpenAITools(tools);
      expect(result.length).toBe(128);
    });
  });
});

// ============================================================================
// 跨格式一致性测试
// ============================================================================

describe('跨格式一致性', () => {
  it('同一工具在两种格式中 name 一致', () => {
    const tool = makeTool({ name: 'consistent_tool' });

    const anthropic = toAnthropicTools([tool]);
    const openai = toOpenAITools([tool]);

    expect(anthropic[0].name).toBe('consistent_tool');
    expect(openai[0].function.name).toBe('consistent_tool');
  });

  it('同一工具在两种格式中都有 schema 信息', () => {
    const tool = makeTool();

    const anthropic = toAnthropicTools([tool]);
    const openai = toOpenAITools([tool]);

    // Anthropic
    const aSchema = anthropic[0].input_schema as Record<string, unknown>;
    expect(aSchema.type).toBe('object');

    // OpenAI
    const oParams = openai[0].function.parameters as Record<string, unknown>;
    expect(oParams.type).toBe('object');
  });

  it('复杂嵌套工具在两种格式中都不抛出异常', () => {
    const tool = makeNestedSchemaTool();

    expect(() => toAnthropicTools([tool])).not.toThrow();
    expect(() => toOpenAITools([tool])).not.toThrow();
  });
});
