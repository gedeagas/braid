const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'always', style: 'short' })

export function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso)
    const diffMs = Date.now() - date.getTime()
    const diffMinutes = Math.max(1, Math.round(diffMs / 60000))
    const diffHours = Math.round(diffMs / (1000 * 60 * 60))
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
    if (diffMinutes < 60) return rtf.format(-diffMinutes, 'minute')
    if (diffHours < 24) return rtf.format(-diffHours, 'hour')
    if (diffDays < 7) return rtf.format(-diffDays, 'day')
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}
