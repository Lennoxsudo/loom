# AGENTS.md — Loom 开发上下文

供贡献者与 AI 编码代理快速理解本仓库。功能细节以代码为准。

## 项目定位

Loom 是本地运行的 AI 辅助 IDE：在同一工作流中整合代码编辑、项目检索、Agent、MCP、终端、内嵌浏览器、Live Server、Git 工作区与代码图谱。

- **版本**：`0.1.14`（manifest）；活跃开发中
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

`tauri-plugin-dialog`、`tauri-plugin-shell`、`tauri-plugin-opener`、`tauri-plugin-updater`

### 内置 Sidecar

| Sidecar | 用途 | 下载脚本 |
|---------|------|----------|
| `codebase-memory` | 代码图谱（CBM） | `npm run fetch:cbm` |
| `whisper-cli` | 本地离线语音转文字（STT） | `npm run fetch:whisper` |

## 目录结构

```text
loom/
├── src/
│   ├── components/
│   │   ├── agent/       # Agent 面板、工具调用、审批、子代理、变更审查、检查点时间线
│   │   ├── chat/        # Chat 面板（含 streamCompletionCoordinator）
│   │   ├── editor/      # Monaco 宿主、标签、分屏、Git Blame
│   │   ├── settings/    # 设置页各选项卡（含 UpdateContent / BuiltinGatewayContent / AgentMemoryContent）
│   │   ├── shared/      # 共享 UI（Markdown、图谱结果卡片、ContextMentionMenu）
│   │   └── ...
│   ├── hooks/
│   ├── stores/          # Zustand stores（含 useAppUpdateStore / useUsageStore / useCheckpointStore / useBuiltinGatewayStore）
│   ├── features/
│   │   └── agent-engine/  # 工具 schema、Handler、执行器、引擎事件
│   ├── shared/lib/        # pathUtils、projectPath、imageGenSizes
│   ├── utils/
│   │   ├── subagents/   # 子代理注册、spawn、嵌套
│   │   ├── compact/     # 上下文自动压缩
│   │   ├── runAgentLoop.ts
│   │   ├── coreSystemPrompt.ts
│   │   ├── contextBudget.ts
│   │   ├── agentMemory.ts / agentMemoryReview.ts / sessionSearch.ts
│   │   ├── projectMemory.ts
│   │   ├── checkpointService.ts / checkpointTimeline.ts
│   │   ├── generateCommitMessage.ts
│   │   ├── voiceRecording.ts
│   │   ├── contextAnnotations.ts
│   │   ├── builtinGateway.ts
│   │   └── ...
│   ├── i18n/            # zh-CN / en-US
│   └── types/
├── src-tauri/
│   ├── src/
│   │   ├── domain/      # 领域模块（ai/chat、integration/cdp_browser 等）
│   │   │   ├── ai/chat/ # 含 builtin_gateway、gateway_sign
│   │   │   └── integration/ # 含 cbm、whisper、checkpoint
│   │   ├── security/   # sandbox、audit_log、context
│   │   └── ...
│   ├── capabilities/    # Tauri 权限（含 updater:default）
│   ├── binaries/        # codebase-memory + whisper-cli sidecar（gitignore，脚本下载）
│   └── resources/whisper/  # whisper 模型与运行时 DLL
├── docs/releases/       # 发版与自动更新说明
├── scripts/
│   ├── fetch-cbm-sidecar.mjs
│   ├── fetch-whisper-sidecar.mjs
│   └── check-release-version.mjs
├── .github/workflows/   # ci.yml、release-windows.yml
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
- **内置网关（Gateway-X）**：无需配置 API Key 即可使用 AI；`builtin_gateway.rs` 提供 health / activate / list_models / get_quota / get_notice 命令
- 协议配置：每协议多 profile；可复制配置；可按模型单独测试连接（`AIConfigContent`）
- 自动路由：设置页配置 fallback 链；新消息从链首开始
- Anthropic Extended Thinking + Prompt Caching（`src-tauri/src/domain/ai/chat/`）
- Gemini `<thought>` 标签自动提升为 thinking 流

### 内置 CDP 浏览器

- Rust：`src-tauri/src/domain/integration/cdp_browser.rs`
- **固定 profile**：`~/.loom/cdp-browser-profile`（复用，非每步操作新建）
- 启动时清理旧版孤儿目录 `cdp-browser-profile-<pid>-…`
- 截图目录：`~/.loom/cdp-screenshots`（每张截图一个 PNG）
- 前端结果卡：`BrowserToolResultCard`（动作名与正文区分色）

### 工具系统

入口：`src/features/agent-engine/`

| 层级 | 文件 |
|------|------|
| Schema | `definitions.ts` |
| 归一化 | `argsParser.ts`、`schema.ts`（含 legacy 别名） |
| 执行 | `toolExecutor.ts`、`registry.ts`（Handler 模块） |
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
| `memory` | 项目记忆（单仓库，`~/.loom/memory/{projectKey}`） |
| `agent_memory` | Agent 记忆（用户级，`~/.loom/agent-memory/`）；子代理默认不暴露 |
| `session_search` | 按需检索过往 Agent 会话（不注入 system prompt）；Chat 面板不暴露 |
| `graph_index` / `graph_query` / `graph_trace` | 代码图谱 |
| `Agent` / `Task` / `run_subagent(s)` | 子代理委派 |

### 记忆系统

两套互不依赖的记忆，仅 Agent 面板使用（Chat 不注入 Agent Memory 约定、不注册相关工具）：

| 能力 | 路径 | 工具 | 说明 |
|------|------|------|------|
| **Agent 记忆** | `~/.loom/agent-memory/{USER,MEMORY}.md` | `agent_memory`、`session_search` | 跨项目用户画像与环境笔记；会话内冻结注入；可选回合后规则整理与写入确认 |
| **项目记忆** | `~/.loom/memory/{projectKey}` | `memory` | 单仓库约定条目 |

Agent 记忆设置（`useSettingsStore` / 设置 → Agent → **Agent 记忆**）：

| 键 | 默认 | 说明 |
|----|------|------|
| `enableAgentMemory` | `true` | 总开关：关则不注入、不写、不跑整理 |
| `enableAgentMemoryUserProfile` | `true` | USER.md |
| `enableAgentMemoryNotes` | `true` | MEMORY.md |
| `enableAgentSessionSearch` | `true` | `session_search` |
| `enableAgentMemoryReview` | `false` | 回合结束后规则抽取「记住/偏好」候选（不调额外模型） |
| `agentMemoryWriteApproval` | `false` | 写入先暂存，对话内容区批准后落盘 |

实现要点：`agentMemory.ts`（IO / 冻结 / 近似去重）、`agentMemoryReview.ts`、`sessionSearch.ts`、`AgentMemoryContent.tsx`（预览与删除）。

### 代码图谱（CBM）

- 内置 sidecar：`codebase-memory`（`npm run fetch:cbm` 下载 UI 变体）
- Rust 模块：`src-tauri/src/cbm/`
- 与外部 MCP **隔离**，不写入用户 MCP 配置
- Tauri 命令：`cbm_graph`、`cbm_schedule_workspace_index`、`cbm_delete_workspace_index`、`cbm_list_indexed_projects`、`cbm_storage_info`、`cbm_start_ui`、`cbm_stop_ui`

### MCP

多服务器启停、tools/resources/prompts、配置持久化。UI 展示时剥离 `mcp_` 前缀。

### 变更审查与检查点

位于 `components/agent/`：`ChangeReviewPanel`、`ChangeReviewDiffView`、`CheckpointTimeline`、`CheckpointFilePreview` 等；后端 stage/commit/rollback + checkpoint create/restore。

### 安全沙箱

- Rust：`src-tauri/src/security/` — sandbox、sandbox_os、context、audit_log
- **CallSource**：区分 `User` 与 `Ai` 来源调用；AI 调用受沙箱约束，用户操作不受限
- **CommandDecision**：`Allow` / `Block` / `NeedsApproval` 三级命令安全判定
- **平台隔离**：Windows 用 Job Object（进程生命周期）；Linux 用 Landlock（内核级文件系统隔离）
- **审计日志**：`audit_log.rs` — `get_audit_logs`、`clear_audit_logs`、`audit_log_count`、`audit_path_denied`
- **检查点**：`src-tauri/src/domain/integration/checkpoint.rs` — `checkpoint_create`、`checkpoint_list`、`checkpoint_restore`、`checkpoint_clear_session`
- **Whisper STT**：`src-tauri/src/domain/integration/whisper.rs` — `transcribe_audio`、`whisper_available`
- 前端配合：`agentSandbox.ts`、`checkpointService.ts`

### Windows 自动更新

- 插件：`tauri-plugin-updater`；配置见 `src-tauri/tauri.conf.json` → `plugins.updater`
- Endpoint：`https://github.com/Lennoxsudo/loom/releases/latest/download/latest.json`（仅正式版）
- 前端运行时：`src/stores/useAppUpdateStore.ts`（检查 / 下载安装状态机；启动检查 single-flight）
- 设置 UI：`src/components/settings/UpdateContent.tsx`（设置 → **版本更新**）
- 偏好：`checkForUpdatesOnStartup`（`useSettingsStore`，默认 `true`）；`App.tsx` 在设置加载后静默检查
- 发版文档：`docs/releases/windows-auto-update.md`；版本对齐脚本：`scripts/check-release-version.mjs`
- 首个带 Updater 的版本为 **v0.1.4**；更早版本需手动安装一次

## Store 层

| Store | 职责 |
|-------|------|
| `useEditorStore` | 标签页、分屏 |
| `useFileStore` | 文件树 |
| `useLayoutStore` | 面板布局 |
| `useSettingsStore` | 设置与审批策略（含 `agentAccessMode`、`toolCallDelay`、`streamSpeed` 等） |
| `useRulesStore` | Rules |
| `useToolStore` | MCP 工具 |
| `useSubagentStore` | 子代理运行状态 |
| `useAutomationStore` | 自动化规则 |
| `useCbmStore` | 代码图谱状态 |
| `useAppUpdateStore` | Windows 更新检查 / 下载安装运行时状态（不持久化） |
| `useUsageStore` | 用量统计与成本追踪（含消费上限） |
| `useCheckpointStore` | 检查点状态 |
| `useBuiltinGatewayStore` | 内置网关激活 / 配额状态 |

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

关键设置项：

| 设置 | 类型 | 说明 |
|------|------|------|
| `agentAccessMode` | `read_only` / `auto` / `full_access` | Agent 访问层级 |
| `themeMode` | 9 种预设 | 主题模式 |
| `voiceInputLanguage` | `auto` / `zh` / `en` | STT 语言 |
| `streamSpeed` | `fast` / `normal` / `slow` | 流式输出速度 |
| `streamSendMode` | `queue_after_stream` / `interrupt_and_send` | 流式中发送行为 |
| `toolCallDelay` | `0` / `500` / `1000` / `2000` / `3000` / `5000` | 工具调用后延迟 |
| `gitBlameInEditor` | `boolean` | 编辑器内 Git Blame |
| `thinkingBlockAutoExpand` | `boolean` | 思考块自动展开 |
| `enableUsageTracking` | `boolean` | 用量追踪总开关 |
| `enableSpendCap` / `spendCap` | `boolean` / `number` | 消费上限 |
| `reasoningEffort` | `low` / `medium` / `high` | 推理努力级别 |
| `enableCdpBrowser` | `boolean` | CDP 浏览器开关 |
| `enableCodeGraph` | `boolean` | 代码图谱开关 |
| `enableSubagents` | `boolean` | 子代理开关 |
| `enableAgentMemory` 等 | `boolean` | Agent 记忆总开关 / User / Notes / 会话检索 / 整理 / 写入确认（见上「记忆系统」） |

### Agent 相关改动

优先查阅：`agentPersistence.ts`、`agent-engine/`、`agentMemory.ts`、`sessionSearch.ts`、`rulesInjector.ts`、`contextBudget.ts`、`coreSystemPrompt.ts`、`runAgentLoop.ts`

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
npm run fetch:cbm          # CBM sidecar（开发/打包前）
npm run fetch:whisper      # Whisper sidecar + 模型（开发/打包前）
npm run tauri dev          # 开发
npm run tauri:build        # 打包（发版签名需 TAURI_SIGNING_PRIVATE_KEY*）
npm test                   # Vitest
npm run lint / npm run format:check
cd src-tauri && cargo test
npm run check:dead-files   # 扫描未引用的 ts/tsx
node scripts/check-release-version.mjs   # 校验各 manifest 版本一致
```

### 发版（Windows 签名更新）

1. 同步 `package.json` / `package-lock.json` / `Cargo.toml` / `tauri.conf.json` 版本号  
2. `node scripts/check-release-version.mjs`  
3. 本地签名构建或推送 `vX.Y.Z` 触发 `.github/workflows/release-windows.yml`  
4. Release 资产需含 NSIS、`.sig`、`latest.json`（及可选 MSI）  

细节见 [docs/releases/windows-auto-update.md](./docs/releases/windows-auto-update.md)。

## 相关文档

- [README.md](./README.md) / [README.zh-CN.md](./README.zh-CN.md) — 用户向介绍与快速开始
- [docs/releases/windows-auto-update.md](./docs/releases/windows-auto-update.md) — Windows 自动更新与发版
- [SECURITY.md](./SECURITY.md) — 漏洞报告
- [NOTICE](./NOTICE) — 第三方声明

---

**维护基准**：以当前仓库代码为准。有疑问时先读相关模块源码，再提 Issue 讨论。
