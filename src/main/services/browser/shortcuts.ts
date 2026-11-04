// Keyboard shortcuts intercepted while a browser guest has focus. The host
// renderer never sees keydowns typed into a <webview>, and a page can swallow
// them before the app menu does, so main catches them in `before-input-event`
// and forwards the action to the renderer.
import type { BrowserShortcutAction } from '../../../shared/browser'

export interface ShortcutInput {
  type: string
  key: string
  code?: string
  meta: boolean
  control: boolean
  shift: boolean
  alt: boolean
}

export function browserShortcutFor(input: ShortcutInput, platform: NodeJS.Platform = process.platform): BrowserShortcutAction | null {
  if (input.type !== 'keyDown') return null
  const isMac = platform === 'darwin'
  const mod = isMac ? input.meta && !input.control : input.control && !input.meta
  if (!mod) return null

  // Option changes the produced character on macOS, so match by physical key.
  if (input.alt) return !input.shift && input.code === 'KeyI' ? 'devtools' : null

  const key = input.key.toLowerCase()
  if (input.shift) {
    if (key === 'r') return 'hardReload'
    if (key === 't') return 'reopenClosedTab'
    return null
  }
  switch (key) {
    case 'f': return 'find'
    case 'r': return 'reload'
    case '[': return 'back'
    case ']': return 'forward'
    case 'l': return 'focusAddress'
    case 't': return 'newTab'
    case 'w': return 'closeTab'
    default: return null
  }
}
