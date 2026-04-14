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
| **System prompt suffix** | Text appended to the system prompt for every session. Use this to enforce team conventions, coding standards, or project-specific instructions that apply globally. | Free-form text, no character limit |
| **API key override** | Provide a custom Anthropic API key. When blank, Braid uses your Claude CLI authentication. | Optional |

## Models

| Model | Best for |
|---|---|
| **Sonnet 4.6** | Balanced speed and quality. Good default for most tasks. |
| **Opus 4.6** | Highest capability. Use for complex reasoning, architecture decisions, and nuanced code review. |
| **Haiku 4.5** | Fastest responses. Use for quick questions, simple edits, and high-volume tasks. |

## System prompt suffix

The suffix is appended after Braid's built-in system prompt. Common uses include:

- Enforcing a code style (e.g., "Always use single quotes and trailing commas")
- Specifying a framework or library preference
- Adding team-specific review criteria

The suffix applies to all sessions across all projects. For project-specific instructions, use a `CLAUDE.md` file in your repository root instead.

## Tips

- You can switch models mid-conversation using the model selector dropdown in the chat panel. The default model setting only affects new sessions.
- Braid uses your Claude CLI authentication by default. You only need to set an API key if you want to override CLI auth or haven't set up the Claude CLI.
