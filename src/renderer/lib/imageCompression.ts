/**
 * Client-side image compression for LLM context conservation.
 *
 * Resizes images to fit within MAX_DIMENSION and re-encodes as JPEG
 * at reduced quality. All formats (PNG, JPEG, GIF, WebP) are compressed
 * - Claude only sees the first frame of GIFs anyway.
 */

const MAX_DIMENSION = 1024
const JPEG_QUALITY = 0.65

/** Load a File into an HTMLImageElement. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

/**
 * Compress an image file for sending to the LLM.
 *
 * - All formats are resized to fit within 1024x1024 and encoded as JPEG at 0.65 quality.
 * - GIFs are flattened to first frame (Claude ignores animation frames anyway).
 * - If the compressed result is larger than the original, the original is returned.
 *
 * Returns a base64 data URI string.
 */
export async function compressImage(file: File): Promise<string> {
  const img = await loadImage(file)
  const { width, height } = img

  // Calculate scaled dimensions
  let targetW = width
  let targetH = height
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height)
    targetW = Math.round(width * scale)
    targetH = Math.round(height * scale)
  }

  // Draw onto canvas and export as JPEG
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) return readAsDataUri(file)
  ctx.drawImage(img, 0, 0, targetW, targetH)

  const compressed = canvas.toDataURL('image/jpeg', JPEG_QUALITY)

  // Estimate original data URI length without reading the file again.
  // Base64 expands by ~4/3, plus the "data:<mime>;base64," prefix (~25 chars).
  const estimatedOriginalLen = Math.ceil(file.size / 3) * 4 + 30

  // If compressed is larger (e.g. tiny image where JPEG overhead dominates), keep original
  if (compressed.length >= estimatedOriginalLen) {
    return readAsDataUri(file)
  }

  return compressed
}

/** Read a File as a base64 data URI (no compression). */
function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
