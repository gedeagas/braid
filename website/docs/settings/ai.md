---
sidebar_position: 3
title: AI
---

# AI

Open Settings with **Cmd+,** and select the **AI** tab to configure the default model, customize the system prompt, or optionally provide an API key override.

## Options

| Option | Description | Details |
|---|---|---|
| **Default model** | Set the Claude model used when you create a new session. You can override the model per session from the model selector in the chat panel. | Sonnet 4.6, Opus 4.6, Haiku 4.5 |
| **Extended context (1M)** | Enable the 1M token context window by default for new sessions. You can still toggle it per session from the model selector. | Off by default |
| **System prompt suffix** | Text appended to the system prompt for every session. Use this to enforce team conventions, coding standards, or project-specific instructions that apply globally. | Free-form text, no character limit |
| **API key override** | Provide a custom Anthropic API key. When blank, Braid uses your Claude CLI authentication. | Optional |

## Models

| Model | Best for | 1M context |
|---|---|---|
| **Sonnet 4.6** | Balanced speed and quality. Good default for most tasks. | Native |
| **Opus 4.6** | Highest capability. Use for complex reasoning, architecture decisions, and nuanced code review. | Native |
| **Mythos** | Extended-context specialist for large-codebase work. | Native |
| **Haiku 4.5** | Fastest responses. Use for quick questions, simple edits, and high-volume tasks. | Standard |
| Older Sonnet models | Legacy workflows. | Beta header (applied automatically) |

## Extended context (1M)

Toggle the 1M token context window from the model selector dropdown in the chat panel. When active, a **1M** badge appears on the model chip so you always know when you are burning through the larger window.

- Opus 4.6, Sonnet 4.6, and Mythos have native 1M support.
- Older Sonnet models use the beta header automatically, no manual flag required.
- Set your preferred default with the **Extended context (1M)** toggle in Settings > AI.

## System prompt suffix

The suffix is appended after Braid's built-in system prompt. Common uses include:

- Enforcing a code style (e.g., "Always use single quotes and trailing commas")
- Specifying a framework or library preference
- Adding team-specific review criteria

The suffix applies to all sessions across all projects. For project-specific instructions, use a `CLAUDE.md` file in your repository root instead.

## Tips

- You can switch models mid-conversation using the model selector dropdown in the chat panel. The default model setting only affects new sessions.
- Braid uses your Claude CLI authentication by default. You only need to set an API key if you want to override CLI auth or haven't set up the Claude CLI.
