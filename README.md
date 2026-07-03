# Loom

Loom 是一个基于 **Tauri 2 + React 19 + TypeScript** 的桌面代码编辑器与本地开发工作台。它将代码编辑、项目检索、AI Agent、MCP、终端、内嵌浏览器、Live Server 与 Git 工作区整合在同一工作流中——目标不是「带聊天框的编辑器」，而是可本地运行的 AI 辅助 IDE。

**当前版本：0.1.0**（早期开源版本，功能持续迭代中）

## 功能概览

### 编辑器与工作区

- Monaco 多标签编辑、分屏、拖拽重排
- 文件树、图片预览、自动保存
- Rust 驱动的全局全文搜索
- Live Server 静态预览与热重载

### AI 与 Agent

- 支持 OpenAI、Anthropic、Gemini、Ollama
- 流式输出、工具调用、思考块、图片附件
- 按项目分会话；配置与历史保存在本地
- 子代理编排（Explore / Plan / general-purpose 及自定义代理）
- 工具审批（always / request / deny）、自动模型路由
- 上下文预算与会话级压缩

### 工具与扩展

- 内置文件、终端、搜索、Git、浏览器、网页抓取等 Agent 工具
- **代码图谱（CBM）**：内置 `codebase-memory` sidecar，提供 `graph_index` / `graph_query` / `graph_trace` 三件套
- MCP 多服务器管理（tools / resources / prompts）
- Skills 技能加载、图片生成、符号定义跳转

### Git 与自动化

- 可视化 Git 工作区（暂存、提交、分支、Stash、Log、Blame 等）
- 自动化规则（定时 / cron / 文件变更触发）
- 多文件变更审查与 Diff 预览

### 其他

- 简体中文 / English
- Agent 独立窗口、内嵌终端（xterm + PTY）
- 内嵌浏览器面板

## 快速开始

### 环境要求

- Node.js 18+
- Rust / Cargo 及对应桌面工具链
- Windows 需 WebView2 与 Visual Studio Build Tools

### 开发

```bash
git clone https://github.com/Lennoxsudo/loom.git
cd loom
npm install
npm run fetch:cbm      # 下载代码图谱 sidecar（开发/打包前需要）
npm run tauri dev      # 启动开发模式
```

### 构建与测试

```bash
npm run tauri:build    # 打包桌面应用（会自动 fetch CBM）
npm test               # 前端测试
npm run lint           # ESLint
cd src-tauri && cargo test   # Rust 测试
```

首次运行前，请在 **设置 → AI 配置** 中填入所用模型的 API Key 与 Endpoint。

## 数据存储

用户数据保存在本机，不会进入 git 仓库：

| 内容 | 典型路径（Windows） |
|------|---------------------|
| Agent 配置与会话 | `%APPDATA%\com.administrator.loom\agent-data\` |
| AI Provider 配置 | `%USERPROFILE%\Loom\ai-config.json` |
| 代码图谱索引 | `%APPDATA%\Loom\cbm\` |

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19、TypeScript、Vite 7、Zustand、Monaco Editor |
| 桌面 | Tauri 2、Rust、Tokio、Axum |
| 测试 | Vitest、Testing Library、Cargo Test |

## 文档

| 文档 | 说明 |
|------|------|
| [AGENTS.md](./AGENTS.md) | 贡献者与 AI 代理的开发上下文 |
| [SECURITY.md](./SECURITY.md) | 安全漏洞报告 |
| [NOTICE](./NOTICE) | 第三方组件声明 |

## 贡献

欢迎 Issue 与 Pull Request。修改代码前建议阅读 [AGENTS.md](./AGENTS.md) 了解目录结构与开发约定。

## 许可证

[Apache-2.0](./LICENSE)
