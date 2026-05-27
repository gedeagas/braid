import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}))

import { mapHookEventToState } from '../agentHookServer'

describe('mapHookEventToState', () => {
  it('treats Codex request_user_input PreToolUse as waiting for input', () => {
    expect(mapHookEventToState('codex', 'PreToolUse', 'request_user_input')).toBe('waiting')
  })

  it('keeps other Codex PreToolUse events as working', () => {
    expect(mapHookEventToState('codex', 'PreToolUse', 'exec_command')).toBe('working')
  })

  it('clears Codex request_user_input after PostToolUse', () => {
    expect(mapHookEventToState('codex', 'PostToolUse', 'request_user_input')).toBe('working')
  })

  it('preserves existing Codex permission mapping', () => {
    expect(mapHookEventToState('codex', 'PermissionRequest')).toBe('waiting')
  })

  it('returns null for unmapped events', () => {
    expect(mapHookEventToState('codex', 'UnknownEvent')).toBeNull()
  })
})
