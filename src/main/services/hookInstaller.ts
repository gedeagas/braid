// ── DEPRECATED: Use agentHooks/ module instead ──────────────────────────────
//
// This file is kept for backward compatibility. All logic has been moved to
// src/main/services/agentHooks/claude.ts.

import { ensureHooks, removeHooks, areHooksInstalled } from './agentHooks/claude'

/** @deprecated Use ensureAllAgentHooks() from agentHooks/ instead. */
export const ensureBraidHooks = ensureHooks

/** @deprecated Use removeAllAgentHooks() from agentHooks/ instead. */
export const removeBraidHooks = removeHooks

/** @deprecated Use claude.areHooksInstalled() from agentHooks/claude instead. */
export const areBraidHooksInstalled = areHooksInstalled
