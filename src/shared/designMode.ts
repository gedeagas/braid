import type { DesignModeCapture } from './browser'

/** Markdown context for an agent from a Design Mode pick. */
export function formatDesignCapture(capture: DesignModeCapture, screenshotPath?: string): string {
  const lines: string[] = []
  lines.push(`## Selected element: \`${capture.tagName}\``)
  lines.push('')
  lines.push(`- Page: ${capture.url}`)
  lines.push(`- Selector: \`${capture.selector}\``)
  lines.push(`- Size: ${capture.rect.width}x${capture.rect.height} at (${capture.rect.x}, ${capture.rect.y})`)
  if (capture.source) {
    const loc = [capture.source.file, capture.source.line, capture.source.column].filter((v) => v !== undefined && v !== null).join(':')
    lines.push(`- Source (${capture.source.framework}): \`${loc}\``)
  }
  if (screenshotPath) lines.push(`- Screenshot: ${screenshotPath}`)
  lines.push('')
  lines.push('### HTML')
  lines.push('```html')
  lines.push(capture.outerHTML)
  lines.push('```')
  const styles = Object.entries(capture.styles)
  if (styles.length > 0) {
    lines.push('')
    lines.push('### Computed styles')
    lines.push('```css')
    for (const [k, v] of styles) lines.push(`${k}: ${v};`)
    lines.push('```')
  }
  if (capture.neighborhood) {
    lines.push('')
    lines.push('### Surrounding markup (parent with children collapsed; the picked element has `data-picked`)')
    lines.push('```html')
    lines.push(capture.neighborhood)
    lines.push('```')
  }
  return lines.join('\n')
}

/** One-line summary used as a chat snippet title / terminal paste header. */
export function designCaptureSummary(capture: DesignModeCapture): string {
  const where = capture.source ? ` (${capture.source.file}${capture.source.line ? `:${capture.source.line}` : ''})` : ''
  return `<${capture.tagName}> ${capture.selector}${where}`
}
