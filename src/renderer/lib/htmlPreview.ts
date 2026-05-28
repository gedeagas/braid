const HTML_PREVIEW_EXTENSIONS = new Set(['html', 'htm'])

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1 || dot === filePath.length - 1) return ''
  return filePath.slice(dot + 1).toLowerCase()
}

export function isHtmlPreviewFile(filePath: string): boolean {
  return HTML_PREVIEW_EXTENSIONS.has(getExtension(filePath))
}

export function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const isWindowsDrivePath = /^[A-Za-z]:\//.test(normalized)
  const encodedPath = normalized
    .split('/')
    .map((segment, index) => {
      if (isWindowsDrivePath && index === 0 && /^[A-Za-z]:$/.test(segment)) {
        return segment
      }
      return encodeURIComponent(segment)
    })
    .join('/')
  return `${isWindowsDrivePath ? 'file:///' : 'file://'}${encodedPath}`
}
