import { useCallback, useEffect, useRef } from 'react'

// JPEG markers
const SOI = 0xffd8
const EOI = 0xffd9

/**
 * Fetches an MJPEG stream directly in the renderer, extracts JPEG frames,
 * and paints the latest frame to a canvas via rAF + createImageBitmap.
 *
 * Performance optimizations:
 * - Pre-allocated growing buffer avoids per-chunk Uint8Array allocation
 * - Zero-copy frame extraction via subarray + single Blob
 * - rAF loop with async bitmap decode prevents main-thread jank
 * - Canvas 2D context cached across draws
 */
export function useMjpegStream(
  isStreaming: boolean,
  onStreamEnded: (error?: string) => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const latestFrameRef = useRef<Uint8Array | null>(null)
  const imgSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  // ── Direct MJPEG fetch ──────────────────────────────────────────────────

  const start = useCallback(async (streamUrl: string) => {
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(streamUrl, { signal: controller.signal })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()

      // Growing buffer — doubles capacity when full, avoids per-chunk alloc
      let buf = new Uint8Array(256 * 1024) // 256KB initial
      let len = 0
      let frameCount = 0
      let lastError = ''

      const ensureCapacity = (need: number) => {
        if (need <= buf.length) return
        let cap = buf.length
        while (cap < need) cap *= 2
        const next = new Uint8Array(cap)
        next.set(buf.subarray(0, len))
        buf = next
      }

      /** Scan raw bytes for "Error: ..." text sent by the server. */
      const extractError = (data: Uint8Array): string | null => {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(data)
        const match = text.match(/Error:\s*(.+)/)
        return match ? match[1].trim() : null
      }

      const readLoop = async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done || controller.signal.aborted) break
          if (!value || value.length === 0) continue

          // Check for server-side error messages embedded in the stream
          const err = extractError(value)
          if (err) lastError = err

          // Append chunk
          ensureCapacity(len + value.length)
          buf.set(value, len)
          len += value.length

          // Scan for complete JPEG frames, keep only the latest
          let latestStart = -1
          let latestEnd = -1
          let i = 0
          while (i < len - 1) {
            if (buf[i] === 0xff && buf[i + 1] === (SOI & 0xff)) {
              // Found SOI — scan for EOI
              for (let j = i + 2; j < len - 1; j++) {
                if (buf[j] === 0xff && buf[j + 1] === (EOI & 0xff)) {
                  latestStart = i
                  latestEnd = j + 2
                  i = j + 2
                  frameCount++
                  break
                }
              }
              if (latestEnd <= i) break // incomplete
            } else {
              i++
            }
          }

          if (latestStart >= 0 && latestEnd > latestStart) {
            // Copy only the frame bytes (small alloc, ~50-150KB per frame)
            latestFrameRef.current = buf.slice(latestStart, latestEnd)

            // Compact: shift remaining bytes to front instead of re-allocating
            const remaining = len - latestEnd
            if (remaining > 0) {
              buf.copyWithin(0, latestEnd, len)
            }
            len = remaining
          }
        }

        // Stream ended — if zero frames were decoded, report the server error
        if (frameCount === 0 && lastError) return lastError
        return undefined
      }

      readLoop().then((streamError) => {
        if (!controller.signal.aborted) onStreamEnded(streamError)
      }).catch((err) => {
        console.error('[MjpegStream] readLoop error:', err)
        if (!controller.signal.aborted) onStreamEnded((err as Error).message)
      })
    } catch (err) {
      console.error('[MjpegStream] fetch/setup error:', err)
      if (!controller.signal.aborted) onStreamEnded((err as Error).message)
    }
  }, [onStreamEnded])

  const stop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = null
  }, [])

  // ── rAF render loop ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isStreaming) return
    let rafId = 0
    let decoding = false
    let ctx: CanvasRenderingContext2D | null = null

    const draw = () => {
      rafId = requestAnimationFrame(draw)
      const frame = latestFrameRef.current
      if (!frame || decoding) return
      latestFrameRef.current = null
      decoding = true

      const blob = new Blob([new Uint8Array(frame)], { type: 'image/jpeg' })
      createImageBitmap(blob).then((bitmap) => {
        decoding = false
        const canvas = canvasRef.current
        if (!canvas) { bitmap.close(); return }
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          ctx = null // invalidate cached context on resize
        }
        imgSizeRef.current = { w: bitmap.width, h: bitmap.height }
        if (!ctx) ctx = canvas.getContext('2d')
        if (ctx) ctx.drawImage(bitmap, 0, 0)
        bitmap.close()
      }).catch(() => { decoding = false })
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [isStreaming])

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (abortRef.current) abortRef.current.abort() }
  }, [])

  return { canvasRef, imgSizeRef, start, stop }
}
