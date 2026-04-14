interface ShortcutBadgeProps {
  symbols: string[]
}

export function ShortcutBadge({ symbols }: ShortcutBadgeProps) {
  return (
    <span className="shortcut-badge">
      {symbols.map((sym, i) => (
        <kbd key={i} className="shortcut-key">
          {sym}
        </kbd>
      ))}
    </span>
  )
}
