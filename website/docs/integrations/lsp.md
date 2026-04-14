---
sidebar_position: 3
title: LSP (Code Intelligence)
---

# LSP (Code Intelligence)

Braid integrates Language Server Protocol (LSP) servers to provide code intelligence features like diagnostics, hover information, go-to-definition, and rename. LSP servers run per-project and are auto-detected based on your codebase.

## What LSP provides

| Feature | Description |
|---------|-------------|
| **Diagnostics** | Errors, warnings, and hints from your language's tooling, shown in the Diagnostics panel |
| **Hover** | Type information and documentation when you hover over symbols in the file editor |
| **Go-to-definition** | Jump to where a function, class, or variable is defined |
| **Rename** | Rename a symbol across all usages in the project |

## Auto-detection

When you open a project, Braid scans for known project markers (like `tsconfig.json`, `Cargo.toml`, `pyproject.toml`, etc.) and detects which language servers are applicable. Detected servers appear in the Diagnostics panel with their status.

## Supported languages

Braid ships with built-in configurations for common language servers:

| Language | Server | Detected via |
|----------|--------|-------------|
| TypeScript/JavaScript | `typescript-language-server` | `tsconfig.json`, `package.json` |
| Rust | `rust-analyzer` | `Cargo.toml` |
| Python | `pyright` | `pyproject.toml`, `requirements.txt` |
| Go | `gopls` | `go.mod` |

Additional servers can be configured per-project in settings.

## Diagnostics panel

The Diagnostics panel in the right panel shows all issues reported by the LSP server. Each diagnostic displays:

- **Severity icon** - Error (red), warning (yellow), info (blue), hint (gray).
- **File path and line number** - Click to open the file at that location in the editor.
- **Message** - The diagnostic text from the language server.
- **Source** - Which tool generated the diagnostic (e.g., "typescript", "pyright").

Diagnostics update in real time as you edit files.

## Status badge

A status badge appears in the Diagnostics panel header showing the current server state:

| Status | Meaning |
|--------|---------|
| **Stopped** | Server is not running |
| **Starting** | Server is initializing |
| **Indexing** | Server is scanning the project |
| **Ready** | Server is fully operational |
| **Error** | Server encountered a problem |

## Install a server

If a language server is detected but not installed on your system, Braid shows an install nudge with instructions. For some servers, Braid can trigger the installation directly.

## Per-project configuration

You can configure LSP servers for each project in **Settings > Project Settings > LSP**. This lets you:

- Enable or disable specific servers.
- Set custom server command paths.
- Add servers that Braid does not auto-detect.

:::tip
LSP diagnostics complement Claude's code review. You can see type errors and warnings in real time while Claude works on your code, catching issues immediately rather than waiting for a build.
:::

:::note
LSP servers run in the background and consume system resources. If you notice high CPU usage, check the Diagnostics panel to see which servers are running and disable any you do not need.
:::
