import React from 'react'

interface KeyboardShortcutProps {
  /** Keys to display, e.g. ['Cmd', 'Shift', 'M'] */
  keys: string[]
}

const KEY_SYMBOLS: Record<string, string> = {
  Cmd: '\u2318',
  Command: '\u2318',
  Shift: '\u21E7',
  Alt: '\u2325',
  Option: '\u2325',
  Ctrl: '\u2303',
  Control: '\u2303',
  Enter: '\u21A9',
  Return: '\u21A9',
  Delete: '\u232B',
  Backspace: '\u232B',
  Escape: '\u238B',
  Esc: '\u238B',
  Tab: '\u21E5',
  Up: '\u2191',
  Down: '\u2193',
  Left: '\u2190',
  Right: '\u2192',
  Space: '\u2423',
}

export default function KeyboardShortcut({ keys }: KeyboardShortcutProps): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
      {keys.map((key, i) => (
        <React.Fragment key={key}>
          <kbd>{KEY_SYMBOLS[key] ?? key}</kbd>
          {i < keys.length - 1 && <span style={{ opacity: 0.4, fontSize: '0.75em' }}>+</span>}
        </React.Fragment>
      ))}
    </span>
  )
}
