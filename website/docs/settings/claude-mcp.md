---
sidebar_position: 5
title: MCP Servers
---

# Claude MCP Servers

MCP (Model Context Protocol) servers extend Claude's capabilities by providing additional tools. Braid lets you configure custom MCP servers that Claude can use during sessions.

## Open MCP settings

Go to **Settings > Claude Config > MCP Servers**.

## Transport types

MCP servers communicate over one of three transports:

| Transport | How it works | Use case |
|-----------|-------------|----------|
| **stdio** | Braid spawns the server as a child process and communicates via stdin/stdout | Local tools, CLI wrappers |
| **SSE** | Braid connects to a server over HTTP with Server-Sent Events | Remote servers, shared services |
| **HTTP** | Braid sends HTTP POST requests to the server | Stateless REST-style servers |

## Add a server

1. Click **Add Server**.
2. Enter a **name** for the server (e.g., "database-tools", "design-system").
3. Select the **transport type**.
4. Configure transport-specific settings:
   - **stdio**: command, arguments, environment variables
   - **SSE**: URL
   - **HTTP**: URL
5. Save.

## Enable and disable servers

Each server has a toggle to enable or disable it. Disabled servers are not started when a session begins. Use this to temporarily turn off a server without removing its configuration.

## OAuth authentication

Some MCP servers require OAuth authentication. When a server needs auth, Braid shows a prompt in the settings with a button to initiate the OAuth flow. The authentication state is cached so you do not need to re-authenticate on every session.

## Health checking

Braid probes configured MCP servers to verify they are reachable:

- **stdio** - Checks that the command exists and is executable.
- **SSE / HTTP** - Sends a probe request to the URL and checks for a valid response.

Health status appears as a colored indicator next to each server name.

:::tip
The Braid MCP server (`braid`) is registered automatically and does not appear in this settings page. It provides git status, notes, session management, and terminal reading tools. See the [Braid MCP Server](/docs/integrations/braid-mcp) documentation for details.
:::

:::note
MCP servers configured here apply to all sessions in the project. If a server is slow or unreliable, it can delay Claude's tool calls. Disable problematic servers to keep sessions responsive.
:::
