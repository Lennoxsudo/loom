/**
 * Agent 单次请求 token 用量估算测试
 *
 * 模拟 AgentPanel 发送第一条消息的完整上下文组装流程，
 * 估算每个阶段注入的 token 数量，帮助理解一次 AI 请求的
 * 实际 token 开销分布。
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateToolsTokens,
} from '../../utils/contextBudget';
import { AI_TOOLS } from '../../features/agent-engine/definitions';
import {
  buildContextForRequest,
  THINKING_PROMPT_MARKER,
  THINKING_PROMPT_TEXT,
} from './utils';
import { APP_DISPLAY_NAME } from '../../utils/coreSystemPrompt';
import { formatRulesContext } from '../../utils/rulesInjector';
import type { AIProvider } from '../../utils/agentPersistence';
import type { ProviderRequestMessage } from '../../types/chat';

/** 模拟项目路径 */
const MOCK_PROJECT_PATH = 'D:\\project\\Loom\\Loom';

/** 模拟 Agent description / system prompt */
const MOCK_AGENT_DESCRIPTION =
  '你是一个专业的编程助手，帮助用户编写、调试和优化代码。你可以使用工具来读取文件、执行命令、搜索代码等。';

/** 模拟 Rules 内容 */
const MOCK_RULES = `## 编码规范
- 使用 TypeScript 严格模式
- 函数组件 + hooks
- CSS Modules
- PascalCase 命名组件文件

## Git 规范
- commit message 使用 conventional commits
- 分支名: feature/xxx, fix/xxx`;

/** 模拟用户第一条消息 */
const MOCK_USER_MESSAGE = '帮我看看项目里 Agent 面板的代码结构';

/** 模拟 Skills 索引上下文（空 = 没有安装 skills） */
const EMPTY_SKILLS_CONTEXT = '';

/** 模拟有 Skills 的上下文 */
const MOCK_SKILLS_CONTEXT = `<available_skills>
"frontend-patterns": React/Next.js 前端开发模式与最佳实践
"backend-patterns": Node.js 后端架构模式与 API 设计
"security-review": 安全审计清单与模式
"tdd-workflow": 测试驱动开发工作流
</available_skills>
当用户请求与某个 skill 的描述匹配时，调用 load_skill 工具并传入 skill_name 来加载完整指令。`;

/** 项目路径上下文前缀 */
const PROJECT_PATH_PREFIX = '[Project Context] Current project path: ';

/** Plan 模式提示 */
const PLAN_MODE_PROMPT =
  '【计划模式】你当前处于只读计划模式。你只能阅读文件、搜索和分析代码，不能写入、修改、创建、删除文件或执行命令。请制定计划并说明你会做什么，但不要实际执行任何修改操作。';

describe('Agent 单次请求 token 用量估算', () => {
  /** 构建一条简单的 ProviderRequestMessage */
  function makeMsg(role: string, content: string): ProviderRequestMessage {
    return { role: role as ProviderRequestMessage['role'], content };
  }

  it('场景1: OpenAI provider，首次消息，有 Rules，无 Skills', () => {
    const provider: AIProvider = 'openai';
    const model = 'gpt-4o';

    // === Step 1: 组装 requestMessages ===
    const requestMessages: ProviderRequestMessage[] = [];

    // Rules 注入
    const rulesContent = formatRulesContext(MOCK_RULES);
    requestMessages.unshift({ role: 'system', content: rulesContent });

    // 用户消息
    requestMessages.push(makeMsg('user', MOCK_USER_MESSAGE));

    // === Step 2: 获取工具定义 ===
    const tools = getOpenAIToolsForProvider(provider);

    // === Step 3: buildContextForRequest ===
    const { messages } = buildContextForRequest({
      systemPrompt: MOCK_AGENT_DESCRIPTION,
      projectPath: MOCK_PROJECT_PATH,
      shouldInjectProjectPath: true,
      skillsContext: EMPTY_SKILLS_CONTEXT,
      requestMessages,
      provider,
      model,
      tools,
    });

    // === Token 估算 ===
    const breakdown = computeTokenBreakdown(messages, tools, provider, model);

    console.warn('\n========== Agent 请求 Token 估算 (OpenAI, 首次, 有 Rules, 无 Skills) ==========');
    logBreakdown(breakdown);
    console.warn('====================================================================\n');

    // 验证基本合理性
    expect(breakdown.totalTokens).toBeGreaterThan(0);
    expect(breakdown.toolTokens).toBeGreaterThan(0);
    expect(breakdown.systemTokens).toBeGreaterThan(0);
  });

  it('场景2: Anthropic provider，首次消息，有 Rules，有 Skills', () => {
    const provider: AIProvider = 'anthropic';
    const model = 'claude-sonnet-4-20250514';

    const requestMessages: ProviderRequestMessage[] = [];
    const rulesContent = formatRulesContext(MOCK_RULES);
    requestMessages.unshift({ role: 'system', content: rulesContent });
    requestMessages.push(makeMsg('user', MOCK_USER_MESSAGE));

    const tools = getOpenAIToolsForProvider(provider);

    const { messages } = buildContextForRequest({
      systemPrompt: MOCK_AGENT_DESCRIPTION,
      projectPath: MOCK_PROJECT_PATH,
      shouldInjectProjectPath: true,
      skillsContext: MOCK_SKILLS_CONTEXT,
      requestMessages,
      provider,
      model,
      tools,
    });

    const breakdown = computeTokenBreakdown(messages, tools, provider, model);

    console.warn('\n========== Agent 请求 Token 估算 (Anthropic, 首次, 有 Rules, 有 Skills) ==========');
    logBreakdown(breakdown);
    console.warn('========================================================================\n');

    expect(breakdown.totalTokens).toBeGreaterThan(0);
    // Anthropic 格式会合并/重构 system 内容，skillsTokens 可能归入 systemTokens
    expect(breakdown.systemTokens).toBeGreaterThan(0);
  });

  it('场景3: OpenAI provider，Plan 模式，首次消息', () => {
    const provider: AIProvider = 'openai';
    const model = 'gpt-4o';

    const requestMessages: ProviderRequestMessage[] = [];
    // Plan 模式注入
    requestMessages.unshift({ role: 'system', content: PLAN_MODE_PROMPT });
    const rulesContent = formatRulesContext(MOCK_RULES);
    requestMessages.unshift({ role: 'system', content: rulesContent });
    requestMessages.push(makeMsg('user', MOCK_USER_MESSAGE));

    const tools = getOpenAIToolsForProvider(provider);

    const { messages } = buildContextForRequest({
      systemPrompt: MOCK_AGENT_DESCRIPTION,
      projectPath: MOCK_PROJECT_PATH,
      shouldInjectProjectPath: true,
      skillsContext: EMPTY_SKILLS_CONTEXT,
      requestMessages,
      provider,
      model,
      tools,
    });

    const breakdown = computeTokenBreakdown(messages, tools, provider, model);

    console.warn('\n========== Agent 请求 Token 估算 (OpenAI, Plan 模式, 首次) ==========');
    logBreakdown(breakdown);
    console.warn('================================================================\n');

    expect(breakdown.totalTokens).toBeGreaterThan(0);
    expect(breakdown.planModeTokens).toBeGreaterThan(0);
  });

  it('场景4: 各组件独立 token 开销', () => {
    console.warn('\n========== 各上下文组件独立 token 开销 ==========');

    // Agent description
    const descTokens = estimateTokens(MOCK_AGENT_DESCRIPTION);
    console.warn(`  Agent description:     ${descTokens} tokens (${MOCK_AGENT_DESCRIPTION.length} chars)`);

    // Rules
    const rulesContent = formatRulesContext(MOCK_RULES);
    const rulesTokens = estimateTokens(rulesContent);
    console.warn(`  Rules (含标签):        ${rulesTokens} tokens (${rulesContent.length} chars)`);

    // Project path
    const projectPathContent = `${PROJECT_PATH_PREFIX}${MOCK_PROJECT_PATH}`;
    const projectPathTokens = estimateTokens(projectPathContent);
    console.warn(`  Project path:          ${projectPathTokens} tokens (${projectPathContent.length} chars)`);

    // Thinking prompt
    const thinkingContent = `${THINKING_PROMPT_MARKER}\n${THINKING_PROMPT_TEXT}`;
    const thinkingTokens = estimateTokens(thinkingContent);
    console.warn(`  Thinking prompt:       ${thinkingTokens} tokens (${thinkingContent.length} chars)`);

    // Plan mode prompt
    const planTokens = estimateTokens(PLAN_MODE_PROMPT);
    console.warn(`  Plan mode prompt:      ${planTokens} tokens (${PLAN_MODE_PROMPT.length} chars)`);

    // Skills context (有 skills 时)
    const skillsTokens = estimateTokens(MOCK_SKILLS_CONTEXT);
    console.warn(`  Skills index (4个):    ${skillsTokens} tokens (${MOCK_SKILLS_CONTEXT.length} chars)`);

    // 工具定义
    const openaiTools = getOpenAIToolsForProvider('openai');
    const openaiToolTokens = estimateToolsTokens(openaiTools);
    console.warn(`  Tool 定义 (OpenAI):    ${openaiToolTokens} tokens (JSON: ${JSON.stringify(openaiTools).length} chars, ${Array.isArray(openaiTools) ? openaiTools.length : 0} tools)`);

    const anthropicTools = getOpenAIToolsForProvider('anthropic');
    const anthropicToolTokens = estimateToolsTokens(anthropicTools);
    console.warn(`  Tool 定义 (Anthropic): ${anthropicToolTokens} tokens (JSON: ${JSON.stringify(anthropicTools).length} chars)`);

    // 用户消息
    const userMsgTokens = estimateTokens(MOCK_USER_MESSAGE);
    console.warn(`  用户消息:              ${userMsgTokens} tokens (${MOCK_USER_MESSAGE.length} chars)`);

    // 总开销估算
    const overheadOpenAI = descTokens + rulesTokens + projectPathTokens + thinkingTokens + openaiToolTokens + userMsgTokens;
    const overheadAnthropic = descTokens + rulesTokens + projectPathTokens + anthropicToolTokens + userMsgTokens;
    console.warn('');
    console.warn(`  --- 首次请求总开销估算 (不含对话历史) ---`);
    console.warn(`  OpenAI:    ~${overheadOpenAI} tokens`);
    console.warn(`  Anthropic: ~${overheadAnthropic} tokens`);
    console.warn('================================================\n');

    expect(descTokens).toBeGreaterThan(0);
    expect(rulesTokens).toBeGreaterThan(0);
    expect(openaiToolTokens).toBeGreaterThan(0);
  });

  it('场景5: 多轮对话 token 增长模拟', () => {
    console.warn('\n========== 多轮对话 token 增长模拟 (OpenAI) ==========');

    const provider: AIProvider = 'openai';
    const model = 'gpt-4o';
    const tools = getOpenAIToolsForProvider(provider);
    const toolTokens = estimateToolsTokens(tools);

    // 模拟不同轮数的对话
    const rounds = [1, 3, 5, 10];
    for (const n of rounds) {
      const requestMessages: ProviderRequestMessage[] = [];
      const rulesContent = formatRulesContext(MOCK_RULES);
      requestMessages.unshift({ role: 'system', content: rulesContent });

      // 模拟 n 轮 user + assistant 对话
      for (let i = 0; i < n; i++) {
        requestMessages.push(makeMsg('user', `第${i + 1}轮用户消息：帮我写一个函数实现 ${i + 1} 的功能`));
        requestMessages.push(makeMsg('assistant', `第${i + 1}轮AI回复：好的，这是一个实现...\n\n\`\`\`typescript\nfunction impl${i + 1}() {\n  return ${i + 1};\n}\n\`\`\``));
      }
      // 最后一轮用户消息
      requestMessages.push(makeMsg('user', '帮我继续优化上面的代码'));

      const { messages } = buildContextForRequest({
        systemPrompt: MOCK_AGENT_DESCRIPTION,
        projectPath: MOCK_PROJECT_PATH,
        shouldInjectProjectPath: true,
        skillsContext: EMPTY_SKILLS_CONTEXT,
        requestMessages,
        provider,
        model,
        tools,
      });

      const msgTokens = messages.reduce<number>((sum, m) => sum + estimateMessageTokens(m as { role: string; content: unknown }), 0);
      const totalTokens = msgTokens + toolTokens;

      console.warn(`  ${n} 轮对话: messages=${messages.length}, msgTokens≈${msgTokens}, toolTokens≈${toolTokens}, total≈${totalTokens}`);
    }

    console.warn('================================================================\n');
    expect(toolTokens).toBeGreaterThan(0);
  });
});

// ==================== 辅助函数 ====================

/** 获取指定 provider 的工具定义 */
function getOpenAIToolsForProvider(provider: AIProvider): unknown {
  // 复用 converters 的逻辑：直接使用 AI_TOOLS
  // 这里用简化版本，与实际 getProviderTools 等价（不含 MCP 额外工具）
  if (provider === 'anthropic') {
    return AI_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
  // OpenAI / Gemini / Ollama 格式
  return AI_TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/** Token 开销分解 */
interface TokenBreakdown {
  systemTokens: number;
  skillsTokens: number;
  agentDescTokens: number;
  projectPathTokens: number;
  thinkingTokens: number;
  rulesTokens: number;
  planModeTokens: number;
  userMsgTokens: number;
  assistantMsgTokens: number;
  toolResultTokens: number;
  messageTokens: number;
  toolTokens: number;
  totalTokens: number;
}

/** 计算组装后消息的 token 分解 */
function computeTokenBreakdown(
  messages: unknown[],
  tools: unknown,
  provider: AIProvider,
  _model: string,
): TokenBreakdown {
  let systemTokens = 0;
  let skillsTokens = 0;
  let agentDescTokens = 0;
  let projectPathTokens = 0;
  let thinkingTokens = 0;
  let rulesTokens = 0;
  let planModeTokens = 0;
  let userMsgTokens = 0;
  let assistantMsgTokens = 0;
  let toolResultTokens = 0;

  for (const msg of messages) {
    const m = msg as { role: string; content: unknown };
    const tokens = estimateMessageTokens(m);
    const content = typeof m.content === 'string' ? m.content : '';

    if (m.role === 'system') {
      systemTokens += tokens;
      if (content.includes('<available_skills>')) skillsTokens += tokens;
      if (content.includes(PROJECT_PATH_PREFIX)) projectPathTokens += tokens;
      if (content.includes(THINKING_PROMPT_MARKER)) thinkingTokens += tokens;
      if (content.includes('[Rules Context]')) rulesTokens += tokens;
      if (content.includes('计划模式')) planModeTokens += tokens;
      // Agent description: system message 中排除以上特殊内容的剩余部分
      // 简化处理：如果不含特殊标记，就认为是 Agent description
      if (
        !content.includes('<available_skills>') &&
        !content.includes(PROJECT_PATH_PREFIX) &&
        !content.includes(THINKING_PROMPT_MARKER) &&
        !content.includes('[Rules Context]') &&
        !content.includes('计划模式') &&
        !content.includes(APP_DISPLAY_NAME) &&
        !content.includes('## Be concise')
      ) {
        agentDescTokens += tokens;
      }
    } else if (m.role === 'user') {
      userMsgTokens += tokens;
    } else if (m.role === 'assistant') {
      assistantMsgTokens += tokens;
    } else if (m.role === 'tool') {
      toolResultTokens += tokens;
    }
  }

  // Anthropic 格式下，content 可能是 array，tool_use/tool_result 内联在 assistant/user content 里
  // 简化处理：直接从 array blocks 中分类
  if (provider === 'anthropic') {
    for (const msg of messages) {
      const m = msg as { role: string; content: unknown };
      if (Array.isArray(m.content)) {
        for (const block of m.content as Record<string, unknown>[]) {
          if (block.type === 'tool_use' || block.type === 'tool_result') {
            toolResultTokens += estimateTokens(JSON.stringify(block));
          }
        }
      }
    }
  }

  const messageTokens = systemTokens + userMsgTokens + assistantMsgTokens + toolResultTokens;
  const toolTokens = estimateToolsTokens(tools);
  const totalTokens = messageTokens + toolTokens;

  return {
    systemTokens,
    skillsTokens,
    agentDescTokens,
    projectPathTokens,
    thinkingTokens,
    rulesTokens,
    planModeTokens,
    userMsgTokens,
    assistantMsgTokens,
    toolResultTokens,
    messageTokens,
    toolTokens,
    totalTokens,
  };
}

/** 打印 token 分解 */
function logBreakdown(b: TokenBreakdown): void {
  console.warn(`  Message tokens:`);
  console.warn(`    System prompt (合并): ${b.systemTokens}`);
  if (b.skillsTokens) console.warn(`      ├─ Skills index:     ${b.skillsTokens}`);
  if (b.agentDescTokens) console.warn(`      ├─ Agent desc:       ${b.agentDescTokens}`);
  if (b.projectPathTokens) console.warn(`      ├─ Project path:     ${b.projectPathTokens}`);
  if (b.thinkingTokens) console.warn(`      ├─ Thinking prompt:  ${b.thinkingTokens}`);
  if (b.rulesTokens) console.warn(`      ├─ Rules:            ${b.rulesTokens}`);
  if (b.planModeTokens) console.warn(`      ├─ Plan mode:        ${b.planModeTokens}`);
  console.warn(`    User messages:         ${b.userMsgTokens}`);
  console.warn(`    Assistant messages:    ${b.assistantMsgTokens}`);
  console.warn(`    Tool results:          ${b.toolResultTokens}`);
  console.warn(`    ─────────────────────────────`);
  console.warn(`    Message subtotal:      ${b.messageTokens}`);
  console.warn(`  Tool definitions:        ${b.toolTokens}`);
  console.warn(`  ═══════════════════════════════`);
  console.warn(`  TOTAL (估算):            ${b.totalTokens} tokens`);
}
