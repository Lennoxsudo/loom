# AGENTS.md — Loom 开发上下文

供贡献者与 AI 编码代理快速理解本仓库。功能细节以代码为准。

## 项目定位

Loom 是本地运行的 AI 辅助 IDE：在同一工作流中整合代码编辑、项目检索、Agent、MCP、终端、内嵌浏览器、Live Server、Git 工作区与代码图谱。

- **版本**：`0.1.0`（manifest）；活跃开发中
- **仓库**：https://github.com/Lennoxsudo/loom

## 技术栈

### 前端

| 类别 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript |
| 构建 | Vite 7 |
| 状态 | Zustand |
| 编辑器 | Monaco (`@monaco-editor/react`) |
| 其他 | `@dnd-kit`、`react-virtuoso`、`xterm`、`react-markdown` |
| 测试 | Vitest 4、Testing Library、fast-check |

### 桌面后端

| 类别 | 技术 |
|------|------|
| 框架 | Tauri 2、Rust 2021 |
| 运行时 | Tokio |
| HTTP | Axum、Reqwest |
| 其他 | Notify、`portable-pty`、`croner` |

### Tauri 插件

`tauri-plugin-dialog`、`tauri-plugin-shell`、`tauri-plugin-opener`

## 目录结构

```text
loom/
├── src/
│   ├── components/
│   │   ├── agent/       # Agent 面板、工具调用、审批、子代理、变更审查
│   │   ├── chat/        # Chat 面板
│   │   ├── editor/      # Monaco 宿主、标签、分屏
│   │   ├── settings/    # 设置页各选项卡
│   │   ├── shared/      # 共享 UI（Markdown、图谱结果卡片等）
│   │   └── ...
│   ├── hooks/
│   ├── stores/          # 9 个 Zustand store
│   ├── features/
│   │   └── agent-engine/  # 工具 schema、Handler、执行器、引擎事件
│   ├── shared/lib/        # pathUtils、projectPath、imageGenSizes
│   ├── utils/
│   │   ├── subagents/   # 子代理注册、spawn、嵌套
│   │   ├── runAgentLoop.ts
│   │   ├── coreSystemPrompt.ts
│   │   ├── contextBudget.ts / contextCompressor.ts
│   │   └── ...
│   ├── i18n/            # zh-CN / en-US
│   └── types/
├── src-tauri/
│   ├── src/
│   │   ├── chat/        # 流式聊天、多 Provider 适配
│   │   ├── cbm/         # 代码图谱 sidecar 集成
│   │   ├── agent_store.rs / conversation.rs
│   │   ├── mcp.rs / terminal.rs / git_workspace.rs
│   │   └── ...
│   └── binaries/        # codebase-memory sidecar（gitignore，fetch:cbm 下载）
├── scripts/
│   └── fetch-cbm-sidecar.mjs
└── package.json
```

## 核心架构

### Agent 与会话

- 全局 Agent 配置：`agent.json`（存于应用数据目录）
- 按项目分会话：`projects/{projectKey}.json`；**磁盘为唯一真相源**
- 会话列表顺序保持磁盘 `conversations` 数组顺序，不按 `updatedAt` 重排
- 主循环：`runAgentLoop.ts`；子代理通过 `Agent`/`Task` 工具委派

### Provider 与路由

- 支持 openai、anthropic、ollama
- 自动路由：设置页配置 fallback 链；新消息从链首开始
- Anthropic Extended Thinking + Prompt Caching（`src-tauri/src/chat/`）

### 工具系统

入口：`src/features/agent-engine/`

| 层级 | 文件 |
|------|------|
| Schema | `definitions.ts`（22 个主工具） |
| 归一化 | `argsParser.ts`、`schema.ts`（含 legacy 别名） |
| 执行 | `toolExecutor.ts`、`registry.ts`（13 个 Handler 模块） |
| 边界 | `events.ts`（`EngineHostCallbacks` / `agentEngineEvents`） |

工具输出**直接返回完整内容**，不做截断或压缩。

**主工具一览**

| 工具 | 用途 |
|------|------|
| `term` | 终端命令（含后台任务） |
| `read` / `edit` / `write` / `delete_file` | 文件操作 |
| `search` / `finfo` / `sym` | 搜索、目录树、符号跳转 |
| `git` | diff / undo |
| `fetch` / `browser` / `web_search` | 网页抓取 / 内嵌浏览器 / 原生 Web 搜索 |
| `ask` / `todo` / `skill` | 提问 / 任务清单 / 技能 |
| `graph_index` / `graph_query` / `graph_trace` | 代码图谱 |
| `Agent` / `Task` / `run_subagent(s)` | 子代理委派 |

### 代码图谱（CBM）

- 内置 sidecar：`codebase-memory`（`npm run fetch:cbm` 下载 UI 变体）
- Rust 模块：`src-tauri/src/cbm/`
- 与外部 MCP **隔离**，不写入用户 MCP 配置
- Tauri 命令：`cbm_graph`、`cbm_schedule_workspace_index`、`cbm_delete_workspace_index`、`cbm_list_indexed_projects`、`cbm_storage_info`、`cbm_start_ui`、`cbm_stop_ui`

### MCP

多服务器启停、tools/resources/prompts、配置持久化。UI 展示时剥离 `mcp_` 前缀。

### 变更审查

位于 `components/agent/`：`ChangeReviewPanel`、`ChangeReviewDiffView` 等；后端 stage/commit/rollback。

## Store 层

| Store | 职责 |
|-------|------|
| `useEditorStore` | 标签页、分屏 |
| `useFileStore` | 文件树 |
| `useLayoutStore` | 面板布局 |
| `useSettingsStore` | 设置与审批策略 |
| `useRulesStore` | Rules |
| `useToolStore` | MCP 工具 |
| `useSubagentStore` | 子代理运行状态 |
| `useAutomationStore` | 自动化规则 |
| `useCbmStore` | 代码图谱状态 |

## 开发约定

### 前端

- TypeScript 严格模式；函数组件 + hooks；CSS Modules
- Zustand 用 selector 细粒度订阅，避免订阅整个 store
- `console.log` 受 ESLint 限制，优先 `warn` / `error`

### 文件命名

- 组件 `PascalCase.tsx`，样式 `PascalCase.module.css`
- 工具 `camelCase.ts`，测试 `*.test.ts(x)`

### Rust

- 新功能放进对应模块，**不要堆回 `lib.rs`**
- 新命令：`#[tauri::command]` + `invoke_handler` 注册

### Windows 注意

- PowerShell 5.1 不支持 `&&` / `||`；终端工具会自动改写常见链式命令
- 内嵌 browser 与 MCP browser 是不同能力
- 终端 resize 有防抖；PowerShell 以 `-NoLogo` 启动

### Vite

`vite.config.ts` 的 `shouldIgnoreViteWatchPath` 限制 dev watch 范围，避免编辑工作区文件触发整应用热重载。

## 扩展指南

### 新增 AI 工具

1. `definitions.ts` 添加 schema
2. 参数归一化 → Handler → `registry.ts` 注册
3. 补充测试（`src/utils/aiTools/__tests__/`）

### 新增 Rust 命令

1. 放进职责对应模块
2. `lib.rs` 的 `invoke_handler` 注册
3. 前端 `invoke()` 调用

### 新增设置项

`types/settings.ts` → `useSettingsStore` → `components/settings/` → `i18n/*`

### Agent 相关改动

优先查阅：`agentPersistence.ts`、`aiTools/`、`rulesInjector.ts`、`contextBudget.ts`、`coreSystemPrompt.ts`、`runAgentLoop.ts`

## 子代理契约

主代理通过 `Agent`/`Task` 委派，统一走 `runAgentLoop`。

| 原则 | 说明 |
|------|------|
| 注册表 | builtin + `~/.claude/agents/` + 项目 `.claude/agents/` |
| 隔离 | 默认 isolated；`resume: self` 继承父会话 |
| 嵌套 | general-purpose 可嵌套，深度上限 5 |
| MCP | 默认继承父会话，受 tools/disallowedTools 过滤 |
| 参数 | `allowed_tools`、`max_tool_rounds`、`context_budget` 由调用方决定 |

关键文件：`utils/subagents/`、`handlers/agentToolHandler.ts`、`handlers/subagentHandlers.ts`、`useSubagentStore.ts`、`git_worktree.rs`

## 构建与测试

```bash
npm install
npm run fetch:cbm          # sidecar（开发/打包前）
npm run tauri dev          # 开发
npm run tauri:build        # 打包
npm test                   # Vitest
npm run lint / npm run format:check
cd src-tauri && cargo test
npm run check:dead-files   # 扫描未引用的 ts/tsx
```

## 相关文档

- [README.md](./README.md) — 用户向介绍与快速开始
- [SECURITY.md](./SECURITY.md) — 漏洞报告
- [NOTICE](./NOTICE) — 第三方声明

---

**维护基准**：以当前仓库代码为准。有疑问时先读相关模块源码，再提 Issue 讨论。
