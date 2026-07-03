<div align="center">

# Loom

**AI 原生的桌面代码编辑器与本地开发工作台。**

把代码编辑、项目检索、AI Agent、子代理编排、MCP、内置代码知识图谱、终端、内嵌浏览器、Live Server 与 Git 整合在同一个本地工作流里。

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-2021-000000?logo=rust&logoColor=white)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#贡献)

[English](./README.md) · **简体中文**

</div>

<!-- TODO: 在此处放一张应用截图或演示 GIF，例如 ![Loom](docs/assets/screenshot.png) -->

> **状态：** 首个开源版本 · `v0.1.0` · 持续活跃开发中，变化较快。

Loom 并非“带聊天框的编辑器”，而是一个完全本地运行、AI 辅助的 IDE：Agent 可以读写你的代码、调用工具、编排子代理，并通过内置的代码知识图谱理解你的项目。

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [配置](#配置)
- [本地数据](#本地数据)
- [子代理编排](#子代理编排)
- [文档](#文档)
- [路线图](#路线图)
- [贡献](#贡献)
- [安全](#安全)
- [许可证](#许可证)
- [致谢](#致谢)

## 功能特性

### 🧩 编辑器与工作区

- Monaco 编辑器：多标签、左右/上下分屏、拖拽重排、Minimap、12+ 项可配置
- 文件树：虚拟滚动、懒加载、拖拽移动、图片预览、自动保存
- Rust 驱动的全局全文与 glob 搜索
- Live Server：Axum 静态服务 + 文件监听 + SSE 热重载

### 🤖 AI 与 Agent

- 多 Provider：**OpenAI、Anthropic、Gemini、Ollama** — 流式输出、工具调用、思考块、图片附件
- 单 Agent 全局配置；**按项目分会话，磁盘为唯一真相源**
- **工具审批模式** — 执行前如何对待工具调用：
  - `always` — 自动执行，不询问
  - `request` — 先征求用户同意
  - `deny` — 禁止调用
- **Agent 能力开关** — 控制 Agent 可使用的权限：
  - `canExecuteCommands` · `canAccessBrowser` · `canUseGit` · `canUseMcp`
- 自动模型路由与 fallback 链
- Anthropic Extended Thinking + Prompt Caching；自动上下文压缩与会话持久化

### 👥 子代理编排

- 通过 `Agent` / `Task`（Claude Code 风格）委派 **Explore / Plan / general-purpose** 或自定义 `.claude/agents/*.md`
- 并行、嵌套（深度 5）、Fork、git worktree 隔离、MCP 继承、可观测性指标

### 🛠️ 工具与代码图谱

Loom 提供 **21 个统一 Agent 工具**，按类别划分如下：

| 类别 | 工具 |
|------|------|
| 文件与搜索 | `read`、`edit`、`write`、`delete_file`、`search`、`finfo`、`sym` |
| 终端与网络 | `term`、`fetch`、`browser` |
| Git 与工作流 | `git`、`ask`、`todo`、`skill` |
| 代码图谱（CBM） | `graph_index`、`graph_query`、`graph_trace` |
| 子代理 | `Agent`、`Task`、`run_subagent`、`run_subagents` |

- **内置代码知识图谱（CBM）**：捆绑 [`codebase-memory`](https://github.com/DeusData/codebase-memory-mcp) sidecar（`npm run fetch:cbm` 下载），支持 Cypher 查询与 3D 图谱 UI
- **MCP**：多服务器生命周期、tools / resources / prompts、Claude 配置联动
- Skills 技能、图片生成、符号定义跳转（TS/TSX/Vue）

### 🌿 Git 与自动化

- 可视化 Git 工作区：暂存/提交/推送、分支、Stash、Log、Blame、合并
- **自动化规则** — 触发器类型：
  - `interval` — 按固定间隔执行
  - `cron` — 按 cron 表达式定时执行
  - `file_change` — 监听文件变更时执行
- 多文件变更审查与 Diff 预览

### 🌐 其他

- 国际化（简体中文 / English）
- Agent 独立窗口、内嵌终端（xterm + PTY）、内嵌浏览器

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19、TypeScript 5.8、Vite 7、Zustand、Monaco Editor、`@dnd-kit`、`react-virtuoso`、`xterm` |
| 桌面 | Tauri 2、Rust 2021、Tokio、Axum、Reqwest、Notify、`portable-pty` |
| 测试 | Vitest、Testing Library、jsdom、fast-check；Cargo Test |

## 快速开始

### 环境要求

- Node.js 18+
- Rust / Cargo 工具链
- Windows 需 WebView2 与 Visual Studio Build Tools

### 开发运行

```bash
git clone https://github.com/Lennoxsudo/loom.git
cd loom
npm install
npm run fetch:cbm      # 下载代码图谱 sidecar（开发/打包前必需）
npm run tauri dev      # 启动开发模式（Vite + Tauri）
```

### 构建与测试

```bash
npm run tauri:build          # 打包桌面应用（自动 fetch CBM）
npm test                     # 前端测试（Vitest）
npm run lint                 # ESLint
npm run format               # Prettier
cd src-tauri && cargo test   # Rust 测试
```

## 配置

首次启动后，在 **设置 → AI** 中填入所用模型的 API Key 与 Endpoint。MCP 服务器在 **设置 → MCP** 配置，代码图谱在 **设置 → 代码图谱** 配置。

## 本地数据

用户数据保存在本机，不会进入仓库：

| 内容 | 典型路径（Windows） |
|------|---------------------|
| Agent 配置与会话 | `%APPDATA%\com.administrator.loom\agent-data\` |
| AI Provider 配置 | `%USERPROFILE%\Loom\ai-config.json` |
| 代码图谱索引缓存 | `%APPDATA%\Loom\cbm\` |

API Key 与凭据仅保存在本地。

## 子代理编排

主代理通过 Claude Code 风格的工具委派子代理，所有 provider 统一走 `runAgentLoop`。

| 入口 | 说明 |
|------|------|
| `Agent` / `Task` | 推荐；`subagent_type` 选择内置或自定义代理 |
| `run_subagent` / `run_subagents` | 兼容旧工具名；支持并行 |

**内置类型：** Explore（只读探索）、Plan（只读规划）、general-purpose（可写、可嵌套）。

**自定义代理** — Markdown + YAML frontmatter，放在：

- `.claude/agents/`（项目级）
- `~/.claude/agents/`（用户级）

**调用时限制**（由主代理在调用参数中指定，非设置页硬编码）：

| 参数 | 说明 |
|------|------|
| `allowed_tools` | 子代理允许使用的工具 |
| `max_tool_rounds` | 最大工具调用轮次 |
| `context_budget` | 本次运行的上下文预算 |

## 文档

| 文档 | 说明 |
|------|------|
| [AGENTS.md](./AGENTS.md) | 贡献者与 AI 代理的开发上下文、目录结构、开发约定 |
| [SECURITY.md](./SECURITY.md) | 安全策略与漏洞上报 |
| [NOTICE](./NOTICE) | 第三方组件声明 |

## 路线图

这是首个公开版本。规划中 / 考虑中：

- 数据库连接器（MySQL / PostgreSQL / Redis）
- 插件系统与市场
- 持续集成（CI）与预构建发布产物
- 上下文缓存与性能的进一步优化

## 贡献

欢迎提交 Issue 与 Pull Request。

- 修改前请先阅读 [AGENTS.md](./AGENTS.md) 了解目录结构与开发约定。
- 约定：TypeScript 严格模式、函数组件 + hooks、CSS Modules、Zustand 细粒度 selector。
- 提交 PR 前请运行 `npm run lint` 与 `npm test`（涉及 Rust 时运行 `cargo test`）。

## 安全

Loom 可在宿主机上执行命令、读写文件并发起网络请求。请只对你信任的代码与 Provider 使用，并在批准工具调用前审阅。漏洞上报见 [SECURITY.md](./SECURITY.md)。

## 许可证

基于 [Apache License 2.0](./LICENSE) 开源。第三方声明见 [NOTICE](./NOTICE)。

## 致谢

- [Tauri](https://tauri.app/)、[React](https://react.dev/)、[Monaco Editor](https://microsoft.github.io/monaco-editor/)、[Zustand](https://github.com/pmndrs/zustand)、[xterm.js](https://xtermjs.org/)
- [codebase-memory](https://github.com/DeusData/codebase-memory-mcp)（MIT）— 驱动内置代码知识图谱
- Anthropic Claude Code — 子代理模型的灵感来源
