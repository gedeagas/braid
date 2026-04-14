/**
 * Binary file detection utilities (main process copy).
 * Keep in sync with src/renderer/lib/binaryFile.ts.
 */

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'tif', 'avif',
])

const BINARY_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a',
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'zip', 'tar', 'gz', '7z', 'rar', 'bz2',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'wasm', 'so', 'dylib', 'dll', 'exe', 'o', 'a',
  'sqlite', 'db',
])

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1 || dot === filePath.length - 1) return ''
  return filePath.slice(dot + 1).toLowerCase()
}

/** True if the file extension indicates a binary format. */
export function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(filePath))
}
