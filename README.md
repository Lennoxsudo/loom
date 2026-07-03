<div align="center">

# Loom

**An AI-native desktop code editor & local development workbench.**

Code editing, project search, AI agents, sub-agent orchestration, MCP, a built-in code knowledge graph, terminal, embedded browser, Live Server and Git — all in one local workflow.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-2021-000000?logo=rust&logoColor=white)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**English** · [简体中文](./README.zh-CN.md)

</div>

<!-- TODO: add a screenshot or short demo GIF here, e.g. ![Loom](docs/assets/screenshot.png) -->

> **Status:** First open-source release · `v0.1.0` · Under active development — expect rapid changes.

Loom is **not** “an editor with a chat box bolted on.” It aims to be a fully local, AI-assisted IDE where the agent can read and edit your code, run tools, orchestrate sub-agents, and understand your codebase through a built-in knowledge graph.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Local Data](#local-data)
- [Sub-agent Orchestration](#sub-agent-orchestration)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Features

### 🧩 Editor & Workspace

- Monaco editor: multi-tab, horizontal/vertical split panes, drag-to-rearrange, minimap, 12+ configurable settings
- File tree with virtual scrolling, lazy loading, drag-move, image preview and autosave
- Rust-powered global full-text & glob search
- Live Server: Axum static host + file watching + SSE hot reload

### 🤖 AI & Agents

- Multiple providers: **OpenAI, Anthropic, Gemini, Ollama** — streaming output, tool calls, thinking blocks, vision/image attachments
- Single global agent config; **per-project conversations with disk as the single source of truth**
- **Tool approval** — how each tool runs before execution:
  - `always` — run without asking
  - `request` — ask for approval first
  - `deny` — block the tool
- **Agent capability switches** — what the agent is allowed to do:
  - `canExecuteCommands` · `canAccessBrowser` · `canUseGit` · `canUseMcp`
- Auto model routing with a configurable fallback chain
- Anthropic Extended Thinking + Prompt Caching; automatic context compaction with session persistence

### 👥 Sub-agent Orchestration

- Delegate via `Agent` / `Task` (Claude Code-style) to **Explore / Plan / general-purpose** or custom `.claude/agents/*.md`
- Parallel execution, nesting (depth 5), Fork, git-worktree isolation, MCP inheritance and observability metrics

### 🛠️ Tools & Code Graph

Loom exposes **21 unified agent tools**, grouped as follows:

| Group | Tools |
|-------|-------|
| Files & search | `read`, `edit`, `write`, `delete_file`, `search`, `finfo`, `sym` |
| Terminal & network | `term`, `fetch`, `browser` |
| Git & workflow | `git`, `ask`, `todo`, `skill` |
| Code graph (CBM) | `graph_index`, `graph_query`, `graph_trace` |
| Sub-agents | `Agent`, `Task`, `run_subagent`, `run_subagents` |

- **Built-in code knowledge graph (CBM)**: bundled [`codebase-memory`](https://github.com/DeusData/codebase-memory-mcp) sidecar (`npm run fetch:cbm`) — Cypher queries and a 3D graph UI
- **MCP**: multi-server lifecycle, tools / resources / prompts, Claude config sync
- Skills, image generation, and symbol-definition jump (TS/TSX/Vue)

### 🌿 Git & Automation

- Visual Git workspace: stage/commit/push, branches, stash, log, blame, merge
- **Automation rules** — trigger types:
  - `interval` — run on a fixed interval
  - `cron` — run on a cron schedule
  - `file_change` — run when watched files change
- Multi-file change review with diff preview

### 🌐 Other

- Internationalization (简体中文 / English)
- Standalone agent window, embedded terminal (xterm + PTY), embedded browser

## Tech Stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19, TypeScript 5.8, Vite 7, Zustand, Monaco Editor, `@dnd-kit`, `react-virtuoso`, `xterm` |
| Desktop | Tauri 2, Rust 2021, Tokio, Axum, Reqwest, Notify, `portable-pty` |
| Testing | Vitest, Testing Library, jsdom, fast-check; Cargo Test |

## Getting Started

### Prerequisites

- Node.js 18+
- Rust toolchain (Cargo)
- Windows: WebView2 + Visual Studio Build Tools

### Run in development

```bash
git clone https://github.com/Lennoxsudo/loom.git
cd loom
npm install
npm run fetch:cbm      # download the code-graph sidecar (required before dev/build)
npm run tauri dev      # start the app in dev mode (Vite + Tauri)
```

### Build & test

```bash
npm run tauri:build          # package the desktop app (auto-fetches CBM)
npm test                     # frontend tests (Vitest)
npm run lint                 # ESLint
npm run format               # Prettier
cd src-tauri && cargo test   # Rust tests
```

## Configuration

On first launch, open **Settings → AI** and add the API key / endpoint for each provider you use. MCP servers are configured under **Settings → MCP**, and the code graph under **Settings → Code Graph**.

## Local Data

User data stays on your machine and is never committed to the repository:

| Data | Typical location (Windows) |
|------|----------------------------|
| Agent config & conversations | `%APPDATA%\com.administrator.loom\agent-data\` |
| AI provider config | `%USERPROFILE%\Loom\ai-config.json` |
| Code graph index cache | `%APPDATA%\Loom\cbm\` |

API keys and provider credentials are stored locally only.

## Sub-agent Orchestration

The main agent delegates to sub-agents through Claude Code-style tools; all providers run through a unified `runAgentLoop`.

| Entry point | Description |
|-------------|-------------|
| `Agent` / `Task` | Recommended; `subagent_type` selects a built-in or custom agent |
| `run_subagent` / `run_subagents` | Legacy-compatible names; support parallel runs |

**Built-in types:** Explore (read-only exploration), Plan (read-only planning), general-purpose (writable, nestable).

**Custom agents** — Markdown + YAML frontmatter in:

- `.claude/agents/` (project)
- `~/.claude/agents/` (user)

**Call-time limits** (set by the main agent, not hard-coded in settings):

| Parameter | Purpose |
|-----------|---------|
| `allowed_tools` | Which tools the sub-agent may use |
| `max_tool_rounds` | Maximum tool-call rounds |
| `context_budget` | Context window budget for the run |

## Documentation

| Document | Description |
|----------|-------------|
| [AGENTS.md](./AGENTS.md) | Contributor & AI-agent development context, directory layout, conventions |
| [SECURITY.md](./SECURITY.md) | Security policy and vulnerability reporting |
| [NOTICE](./NOTICE) | Third-party component attributions |

## Roadmap

This is the first public release. Planned / under consideration:

- Database connectors (MySQL / PostgreSQL / Redis)
- Plugin system & marketplace
- Continuous integration and prebuilt release binaries
- Further context-caching and performance improvements

## Contributing

Contributions are welcome — please open an issue or pull request.

- Read [AGENTS.md](./AGENTS.md) first to understand the directory structure and conventions.
- Conventions: TypeScript strict mode, function components + hooks, CSS Modules, fine-grained Zustand selectors.
- Please run `npm run lint` and `npm test` (and `cargo test` for Rust changes) before submitting a PR.

## Security

Loom can execute commands, read/write files and make network requests on the host machine. Only use it with code and providers you trust, and review tool calls before approving them. To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## License

Licensed under the [Apache License 2.0](./LICENSE). Third-party notices are listed in [NOTICE](./NOTICE).

## Acknowledgements

- [Tauri](https://tauri.app/), [React](https://react.dev/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [Zustand](https://github.com/pmndrs/zustand), [xterm.js](https://xtermjs.org/)
- [codebase-memory](https://github.com/DeusData/codebase-memory-mcp) (MIT) — powers the built-in code knowledge graph
- Anthropic's Claude Code — inspiration for the sub-agent model
