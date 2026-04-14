---
sidebar_position: 2
title: Supported Platforms
---

# Supported Platforms

Braid is a macOS desktop application distributed as a DMG installer.

## System requirements

| Requirement | Details |
|---|---|
| **Operating system** | macOS (Ventura 13.0 or later recommended) |
| **Architecture** | Apple Silicon (arm64) and Intel (x64) |
| **Distribution format** | DMG |

## Prerequisites

Install the following before running Braid.

| Dependency | Purpose | Install |
|---|---|---|
| **GitHub CLI (`gh`)** | Required for GitHub integration -- fetching remote branches, PR checks, and repository operations. | `brew install gh`, then `gh auth login` |
| **Claude CLI** | Required for Claude AI sessions. Braid uses your CLI authentication by default. | Install and run `claude` to authenticate |
| **Anthropic API key** | Optional override if you prefer to use an API key instead of CLI auth. | [console.anthropic.com](https://console.anthropic.com) |

## Installation

1. Download the DMG for your architecture (arm64 or x64).
2. Open the DMG and drag Braid to your Applications folder.
3. Launch Braid from Applications.
4. On first launch, macOS may ask you to confirm opening an app from an identified developer. Click **Open**.

## Verifying your setup

After launching Braid:

1. Open a terminal and run `claude` to verify Claude CLI authentication.
2. Run `gh auth status` to verify GitHub CLI authentication.
3. Add a project from the sidebar to confirm Git integration works.

If `gh` is not installed or not authenticated, GitHub features like remote branch fetching and PR checks are unavailable. Claude sessions require either CLI auth or a custom API key set in **Settings > AI**.
