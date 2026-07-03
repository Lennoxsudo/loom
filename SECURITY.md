# Security Policy

## A note on Loom's capabilities

Loom is a local AI development workbench. By design it can, on the machine it
runs on:

- **Execute arbitrary shell/terminal commands** (foreground and background).
- **Read, write, move and delete files** within opened workspaces.
- **Make arbitrary outbound network requests** to configured AI providers, MCP
  servers and fetched URLs.
- **Run a local HTTP server** (Live Server) and an **embedded browser**.
- **Spawn sub-agents** that inherit these capabilities.

Tool execution is gated by an approval system (`always` / `request` / `deny`)
and per-agent capability flags (`canExecuteCommands`, `canAccessBrowser`,
`canUseGit`, `canUseMcp`). Even so, you should only point Loom at code and
connect it to providers/MCP servers that you trust, and review tool calls
before approving them.

API keys and provider credentials are stored locally in the application data
directory and are never committed to this repository.

## Supported versions

This project is under active development and has not reached a stable 1.0
release. Security fixes are applied to the `main` branch.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately via GitHub's
[private vulnerability reporting](https://github.com/Lennoxsudo/loom/security/advisories/new)
(Security tab -> "Report a vulnerability").

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version / commit.

We aim to acknowledge reports within a few days and will coordinate a fix and
disclosure timeline with you.
