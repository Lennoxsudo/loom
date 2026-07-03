# AGENTS.md - Loom 项目上下文

## 项目定位

Loom 是一个基于 **Tauri 2 + React 19 + TypeScript** 的桌面代码编辑器，目标不是单纯「带聊天框的编辑器」，而是一个把 **代码编辑、项目检索、AI Agent、MCP、终端、内嵌浏览器、Live Server、Git 工作区** 放在同一工作流里的本地开发工作台。

当前仓库实现已明显超出基础编辑器阶段：

- 前端：完整 Agent 面板、工具调用与审批、上下文预算、规则注入、图片附件、子代理编排、Diff 编辑器、Git 面板、自动化、变更审查等
- Rust：终端、文件操作、文件监听、MCP、聊天子模块、会话、浏览器、工具执行、自动化、Git 工作区、沙箱、图片生成、符号定义等
- 工作流：云模型 Agent、子代理编排（Agent/Task 委派）、自动化规则、Git 工作区管理

## 当前技术栈

### 前端

| 类别 | 技术 |
|------|------|
| 核心框架 | React 19 + TypeScript |
| 构建工具 | Vite 7 |
| 状态管理 | Zustand + devtools middleware |
| 编辑器 | Monaco Editor (`@monaco-editor/react`) |
| 拖拽 | `@dnd-kit` |
| 虚拟滚动 | `react-virtuoso` |
| Markdown/渲染 | `react-markdown` + `remark-gfm` + `react-syntax-highlighter` |
| 终端 UI | `xterm` + `xterm-addon-fit` |
| 测试 | Vitest 4 + Testing Library + jsdom + fast-check |

### 桌面后端

| 类别 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 |
| 语言 | Rust 2021 |
| 异步运行时 | Tokio |
| HTTP / SSE | Axum |
| HTTP 客户端 | Reqwest |
| 文件监听 | Notify |
| 终端 PTY | `portable-pty` |
| 其他 | `regex`、`globset`、`trash`、`image`、`html2md`、`croner` |

### Tauri 插件

- `tauri-plugin-dialog`
- `tauri-plugin-shell`
- `tauri-plugin-opener`

## 当前版本与状态

- `package.json` / `Cargo.toml` manifest 版本：`0.1.0`
- 功能里程碑（文档口径）：约 **v0.13.x**（v0.13.0 基线 + 持续打磨）
- 项目状态：活跃开发中
- **判断功能时以代码现状为准**，不要只看 manifest 版本号

## 目录结构

```text
Loom/
├── src/
│   ├── components/
│   │   ├── agent/           # Agent 聊天、工具调用、Todo、子代理、变更审查、审批等
│   │   ├── activity/        # 活动栏图标
│   │   ├── chat/            # 聊天消息、输入、会话、上下文用量等
│   │   ├── diff/            # Diff 编辑器面板
│   │   ├── editor/          # 标签、分屏、右键菜单、Monaco 宿主
│   │   ├── settings/        # 设置各选项卡
│   │   ├── shared/          # 图标、Markdown 渲染、文件类型图标、图谱工具结果视图
│   │   ├── AgentPanel.tsx   # Agent 主工作区
│   │   ├── AgentApp.tsx     # Agent 独立窗口入口
│   │   ├── ChatPanel.tsx / ChatPanelArea.tsx
│   │   ├── FileTree.tsx / FilePreviewPanel.tsx
│   │   ├── GitPanel.tsx / GitPanelContextMenu.tsx
│   │   ├── SearchPanel.tsx / TerminalPanel.tsx / BrowserPanel.tsx
│   │   ├── SettingsView.tsx / ActivityBar.tsx / PanelArea.tsx
│   │   ├── SidebarArea.tsx / TitleBar.tsx
│   │   └── ...
│   ├── config/              # 默认设置、快捷键、编辑器菜单
│   ├── contexts/            # 通知上下文
│   ├── hooks/               # 19 个自定义 hooks（含 CBM 索引/配置同步）
│   ├── i18n/                # zh-CN / en-US
│   ├── stores/              # 9 个 Zustand store
│   ├── styles/              # 全局样式
│   ├── types/               # ai / chat / file / settings / subagent / automation / rules / app
│   ├── utils/
│   │   ├── aiTools/         # 工具定义、Handler、执行器、注册表、测试
│   │   ├── subagents/       # registry、spawn、nesting、catalog
│   │   ├── agentPersistence.ts / rulesInjector.ts / contextBudget.ts
│   │   ├── contextCompressor.ts / dynamicToolFilter.ts / mcpClient.ts
│   │   ├── coreSystemPrompt.ts / scheduleMessageListScroll.ts
│   │   ├── runAgentLoop.ts / skills.ts / monaco*.ts
│   │   └── ...
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs
│   │   ├── chat/            # config, send, stream, types, message_builder, retry, list_models, test_connection, web_fetch
│   │   ├── agent_store.rs / conversation.rs
│   │   ├── file_ops.rs / file_watcher.rs
│   │   ├── mcp.rs / terminal.rs / browser.rs / live_server.rs
│   │   ├── git_workspace.rs / git_diff.rs / git_worktree.rs
│   │   ├── automation.rs / sandbox.rs / symbol_definition.rs
│   │   ├── cbm/                    # 内置 CBM sidecar：graph 工具、索引 schedule、UI
│   │   ├── image_gen/ / tool_executor.rs / editor_settings.rs / debug_log.rs
│   │   └── main.rs
│   ├── capabilities/ / icons/
│   ├── Cargo.toml / tauri.conf.json
├── AGENTS.md / README.md / SECURITY.md / NOTICE
├── package.json
```

## 已落地关键能力

### 编辑器与工作区

Monaco 多标签与分屏、文件树拖拽、预览面板、自动保存、全局搜索、Live Server。

### Agent 与 AI

- **单 Agent**：`agent.json`；**按项目会话**：`projects/{projectKey}.json`
- **磁盘为唯一真相源**；切换项目时 `getProjectState(projectKey)` 从磁盘读取
- **会话列表顺序**：`loadAllProjectThreadSummaries()` 保持磁盘 `conversations` 数组顺序，不按 `updatedAt` 重排
- **子代理**：Agent/Task、并行、嵌套（深度 5）、Fork、worktree、MCP 继承
- **Provider**：openai、anthropic、gemini、ollama
- **Ask 工具**：`ComposerQuestionAnchor` + `InlineQuestionPanel` + `AskToolResultCard`
- **审批**：`always` / `request` / `deny`；`ToolApprovalShell` / `ToolApprovalBar`
- **自动路由**：`AutoRoutingContent` 配置 fallback 链；新发送从链首 provider 开始；工具续跑时 `reuseActiveEntry: true` 可复用当前项；`ProviderSwitchNotice` 运行时提示
- **核心系统提示词**：`coreSystemPrompt.ts` + `buildRuntimeIdentityPrompt`；plan 模式只读变体；`buildContextForRequest` 注入（子代理 `runAgentLoop` 设 `includeCoreSystemPrompt: false`）
- **思考流**：`thinkingExtractor.ts` / `streamChunkSeparation.ts` 分离 reasoning 并清理泄漏标签
- **AgentComposer**：SKILL / MCP 侧栏胶囊、下拉列表、`insertComposerMention` 插入 `@skill` / `@mcp`
- **消息滚动**：`scheduleMessageListScroll.ts` — 用户发送后 Chat / Agent 列表滚到底
- **Extended Thinking** + **Prompt Caching**（Anthropic，`chat/stream.rs` / `send.rs`）
- **Agent 独立窗口**：`open_agent_window` / `show_agent_window`
- Capability：`canExecuteCommands`、`canAccessBrowser`、`canUseGit`、`canUseMcp`

### 工具系统

`src/utils/aiTools/` 包含 schema、参数归一化、Handler 注册表、executor、router、cache、动态过滤。工具输出直接返回完整内容，不再截断或压缩。

**主工具 schema（21 个，`definitions.ts`）**

| 工具 | 说明 |
|------|------|
| `term` | 终端：run / read_output / list_bg / kill（含后台任务、脚本、超时） |
| `read` / `edit` / `write` / `delete_file` | 文件读写编辑删除 |
| `search` | 统一搜索：files / content / both |
| `finfo` | list / tree / info |
| `git` | diff / undo |
| `sym` | 符号定义跳转 |
| `fetch` / `browser` | 网页抓取 / 内嵌浏览器控制 |
| `ask` / `todo` / `skill` | 提问 / 任务清单 / 技能加载 |
| `graph_index` | 代码图谱索引管理：`index`（建索引，CPU 密集）/ `status`（节点/边数）/ `list` / `delete`；新项目须先建索引 |
| `graph_query` | 图谱检索：`search`（名称/标签/文件模式）/ `snippet`（源码）/ `query`（Cypher，须 MATCH 开头）/ `schema`（标签/边类型）/ `code`（grep 搜索） |
| `graph_trace` | 图谱分析：`trace`（调用链 inbound/outbound/both，depth 1-5）/ `architecture`（架构概览）/ `changes`（变更影响）；无 CALLS 边时自动 fallback 查全部关系类型 |
| `run_subagent` / `run_subagents` / `Agent` / `Task` | 子代理委派 |

**Handler 模块（13 个，`registry.ts`）**

`fileHandlersRuntime`、`fileOperationHandlers`、`searchHandlers`、`terminalHandlers`、`gitHandlers`、`browserHandlers`、`interactionHandlers`、`planningHandlers`、`skillHandlers`、`imageGenHandlers`、`subagentHandlers`、`agentToolHandlers`、**`graphHandlers`**

Handler 层仍保留部分 legacy 工具名（如 `move_file`、`copy_file`、`create_folder`、`generate_image`），经 `schema.ts` 别名映射与主 schema 共存。

### 变更审查（原 Composer 能力）

无独立 `components/composer/` 目录；多文件变更审查在 `components/agent/`：

- `ChangeReviewPanel` / `ChangeReviewDiffView` / `ChangeReviewFilePreview`
- `PendingChangeStats` / `ChangeCountCapsule`
- 后端 stage / commit / rollback 命令

### Git 工作区

暂存/提交/推送/分支/Stash/Log/Blame/合并操作；`GitPanel` + 文件级上下文菜单。

### 自动化

`interval` / `cron` / `file_change`；`AutomationsPanel`；规则存于 `agent.json`。

### 代码图谱（CBM）

内置 [codebase-memory](https://github.com/DeusData/codebase-memory-mcp) sidecar，**不写入**用户 MCP 配置，与外部 MCP 并行隔离。

| 能力 | 说明 |
|------|------|
| Agent 工具 | `graph_index`（`index` 建索引 / `status` 查节点边数 / `list` / `delete`）、`graph_query`（`search` 名称标签搜索 / `snippet` 源码 / `query` Cypher 须 MATCH 开头 / `schema` 图谱结构 / `code` grep）、`graph_trace`（`trace` 调用链 + direction/depth / `architecture` 架构概览 / `changes` 变更影响；无 CALLS 边自动 fallback） |
| Rust 模块 | `src-tauri/src/cbm/`：`cli`、`state`、`ui`、`commands`、`path`、`storage` |
| 索引策略 | 打开工作区可自动索引；文件变更 debounce 增量同步；超大仓库可按文件数上限跳过 |
| 设置页 | `CodeGraphContent`：开关、自动索引、文件数上限、当前工作区重索引、已索引项目管理、存储占用、3D UI |
| UI 浏览器 | `cbm_start_ui` 异步启动 sidecar HTTP 服务；`BrowserPanel` 内嵌打开；二进制须为 **UI 变体**（`npm run fetch:cbm`） |
| 全局状态 | `useCbmStore`：sidecar 可用性、已索引项目列表、删除 /  reconcile |
| Rules | 内置模板 `builtin:code-graph`（`graphRulesTemplate.ts`）引导 Agent 优先使用图谱工具 |

Tauri 命令：`cbm_graph`、`cbm_schedule_workspace_index`（含 `force` 重索引）、`cbm_delete_workspace_index`、`cbm_list_indexed_projects`、`cbm_storage_info`、`cbm_ui_status`、`cbm_start_ui`、`cbm_stop_ui`。

### MCP

服务启停、批量启动、tools/resources/prompts、配置持久化、Claude 配置联动；MCP 工具名展示时剥离 `mcp_` 前缀。

### 其他

沙箱上下文、图片生成、Skills、符号定义、调试日志、编辑器设置持久化、PTY 终端（resize 防抖 + 尺寸去重 + PowerShell `-NoLogo`）、`BgTaskBadge` 后台任务指示。

## 前端关键模块

### Agent 子组件（`components/agent/`）

`AgentNavSidebar`、`AgentProjectTree`、`AgentComposer`、`AgentMessageList`、`AgentMessageRow`、`AgentContextBar`、`AgentThreadList`、`AgentWelcomeState`、`AgentProviderProfileModelSelector`、`SubagentCard`、`SubagentGroupCard`、`ThinkingBlock`、`ToolResultMessage`、`AskToolResultCard`、`ComposerQuestionAnchor`、`InlineQuestionPanel`、`ExecCommandCard`、`BrowserToolResultCard`、`McpToolResultCard`、`GenerateImageToolCard`、`GraphToolResultCard`、`ChangeReviewPanel`、`TodoListBar`、`AutomationsPanel`、`ApprovalModeMenu`、`ToolApprovalShell`、`ToolApprovalBar`、`UserMessageStickyBar`、`BgTaskBadge`、`SessionStreamingLoader`

### 聊天子组件（`components/chat/`）

`ChatInputArea`、`ChatMessageList`、`ChatMessageBubble`、`ConversationSelector`、`ProviderModelSelector`、`ChatModeToggle`、`ChatScrollMarkers`、`PendingChangesBar`、`TokenRingIndicator`、`StoragePathModal`、`GraphToolResultCard`

### 设置子组件（`components/settings/`）

`AIConfigContent`、`AIManagementContent`、`AutoRoutingContent`、`AgentContent`、`ClaudeContent`、`MCPConfigContent`、`RulesContent`、`SkillsContent`、`PreferencesContent`、`GeneralContent`、`ImageGenerationSection`

### Store 层（9 个）

| Store | 职责 |
|-------|------|
| `useEditorStore` | 标签页、分组、视图 |
| `useFileStore` | 文件树 |
| `useLayoutStore` | 面板布局 |
| `useSettingsStore` | 设置与审批策略 |
| `useRulesStore` | Rules |
| `useToolStore` | MCP 工具 |
| `useSubagentStore` | 子代理运行/取消/审批 |
| `useAutomationStore` | 自动化规则 |
| `useCbmStore` | CBM 代码图谱状态（sidecar 可用性、已索引项目） |

## Rust 后端命令分布

从 `lib.rs` 注册看，职责包括：终端、文件读写搜索、Git diff/workspace、符号定义、Live Server、AI 配置与流式聊天、会话与图片、Agent store、文件监听、浏览器、MCP、编辑器设置、自动化、沙箱、调试日志、图片生成、worktree 隔离、Agent 独立窗口。

**新增功能优先放进已有模块**，不要堆回 `lib.rs`。

## 测试现状

约 **146 个测试文件**（112 个 `.test.ts` + 34 个 `.test.tsx`），分布在：

- `src/components/agent/**`、`src/components/chat/**`、`src/components/__tests__/**`
- `src/utils/**`、`src/utils/aiTools/__tests__/**`、`src/utils/subagents/__tests__/**`
- `src/stores/__tests__/**`、`src/types/__tests__/**`
- 根级 `src/search-navigation.test.tsx`、`src/monaco-loader.test.ts`

覆盖：tool executor/handler、rules、context budget/compressor、core system prompt、agent persistence（fast-check）、subagent registry/nesting/spawnPolicy/E2E、git 工具函数、自动化 store、审批 UI、Ask 工具、流式分块、终端 resize 同步、消息列表滚动、graph tool result 解析与渲染等。

## 构建与测试命令

```bash
npm install
npm run dev / npm run build / npm run preview
npm run tauri dev / npm run tauri build    # 通过 npm run tauri -- dev/build
npm test / npm run test:watch / npm run test:coverage
npm run lint / npm run lint:fix
npm run format / npm run format:check
cd src-tauri && cargo test
```

`build` 执行 `tsc && vite build`。

## 开发约定

### 前端

- TypeScript 严格模式；`moduleResolution: bundler`
- 函数组件 + hooks；CSS Modules 为主
- Zustand 用 selector 细粒度订阅
- `console.log` 受 ESLint 限制，优先 `console.warn` / `console.error`

### 文件命名

- 组件：`PascalCase.tsx`；样式：`PascalCase.module.css`
- 工具：`camelCase.ts`；测试：`*.test.ts` / `*.test.tsx`

### 状态管理

```ts
const fontSize = useFontSize();
const tabSize = useTabSize();
```

避免无谓订阅整个 store。

## 重要事实

### 1. MCP 超出工具调用

含 resources、prompts、配置读写、Claude 配置联动。

### 2. Rust 模块勿回退旧描述

真实模块见上文目录结构；不要写成「只有 lib.rs / live_server / agent_store」。

### 3. Vite 监听定制

`vite.config.ts` 的 `shouldIgnoreViteWatchPath` 限制 dev watch 范围，避免编辑工作区文件触发整应用热重载。

### 4. Windows 注意

- PowerShell 5.1 不支持 `&&` / `||`；`run_command` 工具会自动改写常见链式命令
- 内嵌 browser 与 MCP browser 是不同能力
- 终端面板拖动 resize：`TerminalPanel` 对 PTY 同步做防抖与尺寸去重；`terminal.rs` 跳过相同 `rows`/`cols`；PowerShell 以 `-NoLogo` 启动，减轻横幅重复

## 扩展路径

### 新增前端功能

1. 复用 `components` / `hooks` / `stores` 分层
2. Agent 行为：查 `agentPersistence.ts`、`aiTools/`、`rulesInjector.ts`、`contextBudget.ts`、`contextCompressor.ts`（会话级压缩，非工具输出压缩）、`dynamicToolFilter.ts`、`coreSystemPrompt.ts`
3. 设置项：查 `types/settings.ts`、`useSettingsStore`、`components/settings/`、`i18n/*`
4. 子代理：查 `utils/subagents/`、`useSubagentStore`、`types/subagent.ts`、`runAgentLoop.ts`

### 新增 Rust 命令

1. 放进对应职责模块
2. `#[tauri::command]` + `invoke_handler` 注册
3. 前端 `invoke()` 调用

### 新增 AI 工具

1. `definitions.ts` → 参数类型与归一化 → handler → `registry.ts` → 测试

## 子代理任务契约

对标 Claude Code CLI Subagents：主代理通过 `Agent`/`Task`（或 `run_subagent`/`run_subagents`）委派，统一走 `runAgentLoop`。

### 设计原则

- **注册表**：`registry.ts` 合并 builtin + `~/.claude/agents/` + 项目 `.claude/agents/`（project > user > builtin）
- **AI 控制委派**：`allowed_tools`、`max_tool_rounds`、`context_budget` 由主代理调用参数决定；frontmatter 仅默认值
- **隔离上下文**：默认 isolated；`resume: self` 继承父会话快照
- **嵌套**：general-purpose 可嵌套；后台深度上限 5
- **摘要回传**：`SubagentResult` 含 summary、artifacts、assumptions、metrics
- **MCP 继承**：默认继承父会话 MCP，受 `tools`/`disallowedTools` 过滤
- **开关**：`enableSubagents` 默认开启

### 交互示意

```mermaid
sequenceDiagram
    participant Main as 主代理
    participant AgentTool as Agent/Task 工具
    participant Registry as SubagentRegistry
    participant Spawn as spawnSubagent
    participant Loop as runAgentLoop
    Main->>AgentTool: Agent(prompt, subagent_type)
    AgentTool->>Registry: 查找定义
    AgentTool->>Spawn: 构建 SubagentTask
    Spawn->>Loop: 隔离循环 + MCP/审批/模型
    Loop-->>Spawn: finalText + steps
    Spawn-->>Main: SubagentResult 摘要
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/utils/subagents/` | registry、spawn、toolMapping、catalog、nesting |
| `handlers/agentToolHandler.ts` | Agent / Task |
| `handlers/subagentHandlers.ts` | run_subagent / run_subagents |
| `runAgentLoop.ts` | 子代理执行循环 |
| `types/subagent.ts` | SubagentTask / Result / Run |
| `useSubagentStore.ts` | 运行状态与取消/审批 |
| `SubagentCard.tsx` | 单卡 UI |
| `git_worktree.rs` | worktree 隔离 |

### 自定义子代理示例

```markdown
---
name: my-agent
description: When to delegate to this agent
tools: Read, Write, Bash
model: inherit
maxTurns: 15
color: "#4a9eff"
---

System prompt body here.
```

## 相关文档

- [README.md](./README.md)
- [SECURITY.md](./SECURITY.md)
- [NOTICE](./NOTICE)

---

**最后更新**：2026-07-03（开源整理：移除内部进度文档、sidecar 重命名为 codebase-memory）
**维护基准**：以当前仓库代码结构为准
