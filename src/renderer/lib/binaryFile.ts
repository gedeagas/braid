/**
 * Binary file detection utilities.
 * Used by DiffReviewView and FileViewer to handle binary files gracefully.
 */

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'tif', 'avif',
])

const BINARY_EXTENSIONS = new Set([
  // Images
  ...IMAGE_EXTENSIONS,
  // Fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // Audio
  'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a',
  // Video
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  // Archives
  'zip', 'tar', 'gz', '7z', 'rar', 'bz2',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // Compiled
  'wasm', 'so', 'dylib', 'dll', 'exe', 'o', 'a',
  // Data
  'sqlite', 'db',
])

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', bmp: 'image/bmp',
  tiff: 'image/tiff', tif: 'image/tiff', avif: 'image/avif',
}

/** Maps extensions to i18n keys in the 'right' namespace (e.g., "binaryType.font"). */
const TYPE_KEYS: Record<string, string> = {
  woff: 'binaryType.font', woff2: 'binaryType.font', ttf: 'binaryType.font', otf: 'binaryType.font', eot: 'binaryType.font',
  mp3: 'binaryType.audio', wav: 'binaryType.audio', ogg: 'binaryType.audio', aac: 'binaryType.audio', flac: 'binaryType.audio', m4a: 'binaryType.audio',
  mp4: 'binaryType.video', webm: 'binaryType.video', mov: 'binaryType.video', avi: 'binaryType.video', mkv: 'binaryType.video',
  zip: 'binaryType.archive', tar: 'binaryType.archive', gz: 'binaryType.archive', '7z': 'binaryType.archive', rar: 'binaryType.archive', bz2: 'binaryType.archive',
  pdf: 'binaryType.document', doc: 'binaryType.document', docx: 'binaryType.document',
  xls: 'binaryType.spreadsheet', xlsx: 'binaryType.spreadsheet',
  ppt: 'binaryType.presentation', pptx: 'binaryType.presentation',
  wasm: 'binaryType.wasm', so: 'binaryType.sharedLib', dylib: 'binaryType.sharedLib', dll: 'binaryType.sharedLib',
  exe: 'binaryType.executable', o: 'binaryType.objectFile', a: 'binaryType.archive',
  sqlite: 'binaryType.database', db: 'binaryType.database',
}

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1 || dot === filePath.length - 1) return ''
  return filePath.slice(dot + 1).toLowerCase()
}

/** True if the file extension indicates a binary format. */
export function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(filePath))
}

/** True if the file is a renderable image (can be shown as <img>). */
export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath))
}

/** MIME type for a renderable image extension, or null. */
export function imageMimeType(filePath: string): string | null {
  return MIME_MAP[getExtension(filePath)] ?? null
}

/** True if git's diff output indicates a binary file. */
export function isGitBinaryDiff(diffOutput: string): boolean {
  return /^Binary files .+ differ$/m.test(diffOutput)
    || diffOutput.includes('GIT binary patch')
}

/** Returns an i18n key (right namespace) for the binary file type. */
export function binaryTypeLabel(filePath: string): string {
  return TYPE_KEYS[getExtension(filePath)] ?? 'binaryType.binary'
}

/** Format byte count as human-readable string. */
export function formatFileSize(bytes: number): string {
  if (bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
