# Loom

Loom 是一个基于 **Tauri 2 + React 19 + TypeScript** 的桌面代码编辑器与本地开发工作台。它将代码编辑、项目检索、AI Agent、MCP、终端、内嵌浏览器、Live Server 与 Git 工作区管理整合在同一工作流中，目标不是「带聊天框的编辑器」，而是可本地运行的 AI 辅助 IDE。

> **版本说明**：`package.json` / `Cargo.toml` manifest 版本号为 `0.1.0`；功能以当前代码为准，里程碑约为 **v0.14.x**。

## 核心特性

### 编辑器与工作区

- Monaco Editor：多标签页、左右/上下分屏、拖拽重排、语法高亮、Minimap、12+ 项可配置编辑器参数
- 文件树：虚拟滚动、懒加载、拖拽移动、图片预览、自动保存
- 全局搜索：Rust 驱动全文检索，防抖、高亮、跳转定位
- Live Server：Axum 静态服务、文件监听、SSE 热重载、自动端口分配

### AI 与 Agent

- 多提供商：OpenAI、Anthropic、Gemini、Ollama；支持流式输出、工具调用、思考块、Vision 图片附件
- **单 Agent 配置**：全局一份 `agent.json`；**按项目分会话**，磁盘为唯一真相源
- **子代理编排**：`Agent` / `Task` 委派 Explore / Plan / general-purpose 或自定义 `.claude/agents/*.md`；支持并行、嵌套（深度 5）、Fork、worktree 隔离、MCP 继承
- **Ask 工具**：`ComposerQuestionAnchor` 浮于输入框上方；`AskToolResultCard` 紧凑回显用户选择
- **审批模式**：工具调用 `always` / `request` / `deny`；`ToolApprovalShell` / `ToolApprovalBar` 内联审批 UI
- **自动路由**：设置页配置多模型 fallback 链；新消息从链首 provider 开始；工具续跑时可复用当前 provider；运行时切换提示
- **核心系统提示词**：`coreSystemPrompt.ts` 可组合身份与行为章节；plan 模式只读变体；经 `buildContextForRequest` 注入
- Anthropic Extended Thinking：signature 收集、持久化、回传
- Anthropic Prompt Caching：system / tools / 历史消息断点（`chat/stream.rs`）
- 上下文预算：`contextBudget` + `contextCompressor`（会话级压缩）；工具输出直接返回完整内容，不再截断

### 工具与扩展

- **21 个主工具 schema**（`definitions.ts`）：含 `graph_index` / `graph_query` / `graph_trace`（内置 CBM 代码图谱）及 `term`、`read`、`edit`、`write`、`search`、`finfo`、`git`、`sym`、`fetch`、`browser`、`ask`、`todo`、`skill`、`delete_file`、`run_subagent`、`run_subagents`、`Agent`、`Task`
- **内置代码图谱（CBM）**：内置 sidecar `codebase-memory`（`npm run fetch:cbm` 下载 UI 变体）；索引缓存位于应用数据目录 `{app_data}/cbm/`；设置 → **代码图谱** 可开关、自动索引、重索引当前工作区、管理已索引项目、查看存储占用、打开 3D 图谱浏览器（内嵌标签页，默认 `http://127.0.0.1:9749`）。三个 Agent 工具：
  - `graph_index`：索引管理（`index` 建索引 / `status` 查状态 / `list` 列项目 / `delete` 删索引）
  - `graph_query`：符号检索（`search` 名称/标签搜索 / `snippet` 源码 / `query` Cypher / `schema` 图谱结构 / `code` grep 搜索）
  - `graph_trace`：关系分析（`trace` 调用链 inbound/outbound/both / `architecture` 架构概览 / `changes` 变更影响）
- **13 个领域 Handler**：file、fileOperation、search、terminal、git、browser、interaction、planning、skill、imageGen、subagent、agentTool、**graph**
- MCP：多服务器生命周期、tools / resources / prompts、Claude 配置联动
- Skills：技能加载与设置页管理
- 图片生成：`generate_image` 命令与配置 UI
- 符号定义跳转：TypeScript/TSX/Vue import 解析

### Git 与自动化

- 完整 Git 工作区：`GitPanel` 可视化暂存/提交/推送/分支/Stash/Log/Blame
- 自动化规则：`interval` / `cron` / `file_change` 触发器 + `AutomationsPanel`
- 变更审查：`ChangeReviewPanel` / Diff 预览 / 待提交变更统计

### 其他

- 国际化：简体中文、English（覆盖 Agent / MCP / 设置 / 工具调用等）
- Agent 独立窗口、`BgTaskBadge` 后台终端任务指示
- 用户消息置顶预览（`UserMessageStickyBar`）
- Chat / Agent 发送消息后自动滚到底部
- 内嵌终端：xterm + PTY；拖动面板 resize 防抖，避免 PowerShell 横幅重复叠加

## 子代理编排

主代理通过 Claude Code 风格工具委派子代理，所有 provider 统一走自研 `runAgentLoop`：

| 入口 | 说明 |
|------|------|
| `Agent` / `Task` | 推荐；`subagent_type` 选择内置或自定义代理 |
| `run_subagent` / `run_subagents` | 兼容旧工具名；支持并行 |

**内置类型**：Explore（只读探索）、Plan（只读规划）、general-purpose（可写、可嵌套）

**高级能力**：嵌套 spawn、Fork（`resume: self`）、worktree 隔离、MCP 继承、可观测性指标（耗时/步数/token）

自定义代理：在项目 `.claude/agents/` 或 `~/.claude/agents/` 添加 Markdown（YAML frontmatter + prompt body）。

委派时的并发、上下文预算、工具轮次由主代理在调用参数中指定（`allowed_tools`、`max_tool_rounds`、`context_budget`），不在设置页硬编码限制。

## 技术架构

| 层 | 技术 |
|----|------|
| 前端 | React 19、TypeScript 5.8、Vite 7、Zustand、Monaco、`@dnd-kit`、`react-virtuoso`、`xterm` |
| 桌面 | Tauri 2、Rust 2021、Tokio、Axum、Reqwest、Notify、`portable-pty` |
| 测试 | Vitest 4、Testing Library、jsdom、fast-check；Cargo Test |

### 主要 Store

`useEditorStore`、`useFileStore`、`useLayoutStore`、`useSettingsStore`、`useRulesStore`、`useToolStore`、`useSubagentStore`、`useAutomationStore`、`useCbmStore`

### Rust 模块

`chat/`、`file_ops`、`mcp`、`terminal`、`agent_store`、`conversation`、`git_workspace`、`git_diff`、`git_worktree`、`automation`、`browser`、`live_server`、`file_watcher`、`image_gen/`、`sandbox`、`symbol_definition`、`tool_executor`、`editor_settings`、`debug_log`、`cbm/`

## 项目文档

| 文档 | 说明 |
|------|------|
| [AGENTS.md](./AGENTS.md) | 贡献者与 AI 代理上下文、目录结构、开发约定 |
| [SECURITY.md](./SECURITY.md) | 安全漏洞报告方式 |
| [NOTICE](./NOTICE) | 第三方组件声明（含 CBM sidecar） |

## 开发部署

### 环境要求

- Node.js 18+
- Rust / Cargo 及对应桌面工具链（Windows 需 WebView2、Visual Studio Build Tools）
- npm / pnpm / yarn

### 常用命令

```bash
npm install
npm run tauri dev      # 开发模式（Vite + Tauri）
npm run fetch:cbm      # 下载内置 CBM sidecar（开发/打包前；UI 变体约数十 MB）
npm run tauri:build    # fetch CBM + 构建桌面应用
npm test               # 前端测试
npm run test:watch     # 测试监听模式
npm run lint           # ESLint
npm run format         # Prettier
cd src-tauri && cargo test   # Rust 测试
```

## 版本里程碑（摘要）

| 版本 | 要点 |
|------|------|
| v0.1.0 | Tauri + React 基础框架、Monaco、文件树 |
| v0.3.0 | 分屏编辑、Live Server、右键菜单 |
| v0.5.0 | AI 聊天、全文搜索、工具调用 |
| v0.9.0 | MCP 集成、AI 工具模块化、i18n |
| v0.10.0 | Composer 变更审查、Rules、Git 工作区、自动化 |
| v0.11.0 | Anthropic Extended Thinking、OpenAI 流式 404 Fallback |
| v0.12.0 | 子代理全链路、CLI Agent 移除、Ask UI、会话列表顺序策略 |
| v0.13.0 | Prompt Caching、工具审批 UI、自动路由、工具 schema 整合、后台终端任务 |
| v0.13.x（打磨中） | 核心系统提示词模块、自动路由链首重试、思考流标签清理、终端 resize 防抖、SKILL/MCP 胶囊、发送后自动滚动 |
| v0.14.x（进行中） | 内置 CBM 代码图谱：`graph_*` 三工具、`src-tauri/src/cbm/`、设置页代码图谱（重索引、项目管理、3D UI）、TitleBar 已索引菜单、删除索引锁释放与错误提示、内嵌浏览器 SVG 工具栏；移除 `chunk` 工具与工具输出压缩机制，工具直返完整输出；新增 `GraphToolResultCard` 图谱工具结果渲染（Agent / Chat 共享 `shared/graphToolResult/`） |

## 许可证

遵循 [LICENSE](./LICENSE) 中的授权协议。
