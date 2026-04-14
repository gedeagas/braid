import { useCallback, useRef } from 'react'
import type React from 'react'

const MOVE_THRESHOLD = 8
const SWIPE_THRESHOLD = 20
const LONG_PRESS_MS = 500

// Path simplification: keep at most N waypoints from the drag track
const MAX_WAYPOINTS = 8

interface Point { x: number; y: number }
interface TrackPoint { x: number; y: number; t: number }

/**
 * Detects tap, long-press, and swipe/drag gestures on a canvas element,
 * maps pixel coordinates to device points, and fires W3C pointer action sequences.
 *
 * Gestures are sent as complete atomic sequences on mouseUp because the
 * `device.io.gesture` RPC is stateless between calls — pointer state resets
 * after each invocation, so streaming individual events doesn't work.
 *
 * Swipe fidelity: instead of interpolating a straight line from start→end,
 * we record the actual mouse path and send simplified waypoints so curves
 * and direction changes are preserved.
 */
export function useGesture(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  imgSizeRef: React.RefObject<{ w: number; h: number }>,
  screenSize: { width: number; height: number } | null,
  onGesture: (actions: Record<string, unknown>[]) => void,
) {
  const gestureRef = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trackRef = useRef<TrackPoint[]>([])

  const toDevicePoint = useCallback((clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current
    if (!screenSize || !canvas) return null
    const { w: imgW, h: imgH } = imgSizeRef.current
    if (!imgW || !imgH) return null

    const rect = canvas.getBoundingClientRect()
    const { width: ptW, height: ptH } = screenSize
    const imgAspect = imgW / imgH
    const containerAspect = rect.width / rect.height

    let renderW: number, renderH: number, offsetX: number, offsetY: number
    if (containerAspect > imgAspect) {
      renderH = rect.height; renderW = renderH * imgAspect
      offsetX = (rect.width - renderW) / 2; offsetY = 0
    } else {
      renderW = rect.width; renderH = renderW / imgAspect
      offsetX = 0; offsetY = (rect.height - renderH) / 2
    }

    const relX = (clientX - rect.left - offsetX) / renderW
    const relY = (clientY - rect.top - offsetY) / renderH
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null
    return { x: Math.round(relX * ptW), y: Math.round(relY * ptH) }
  }, [canvasRef, imgSizeRef, screenSize])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const now = Date.now()
    gestureRef.current = { x: e.clientX, y: e.clientY, t: now, moved: false }
    trackRef.current = [{ x: e.clientX, y: e.clientY, t: now }]

    longPressTimerRef.current = setTimeout(() => {
      const g = gestureRef.current
      if (!g || g.moved) return
      const pt = toDevicePoint(g.x, g.y)
      if (pt) {
        onGesture([
          { type: 'pointerMove', duration: 0, x: pt.x, y: pt.y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: Date.now() - g.t },
          { type: 'pointerUp', button: 0 },
        ])
      }
      gestureRef.current = null
      trackRef.current = []
    }, LONG_PRESS_MS)
  }, [toDevicePoint, onGesture])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current
    if (!g) return

    trackRef.current.push({ x: e.clientX, y: e.clientY, t: Date.now() })
    // Cap at 200 points — plenty for path reconstruction
    if (trackRef.current.length > 200) trackRef.current.splice(0, trackRef.current.length - 200)

    const dx = e.clientX - g.x, dy = e.clientY - g.y
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
      g.moved = true
      if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
    }
  }, [])

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
    const g = gestureRef.current
    const track = trackRef.current
    gestureRef.current = null
    trackRef.current = []
    if (!g) return

    const dx = e.clientX - g.x, dy = e.clientY - g.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > SWIPE_THRESHOLD) {
      // Append the final mouseUp point to the track
      track.push({ x: e.clientX, y: e.clientY, t: Date.now() })
      const actions = buildActionsFromTrack(track, toDevicePoint)
      if (actions) onGesture(actions)
    } else if (!g.moved && Date.now() - g.t < LONG_PRESS_MS) {
      // Simple tap
      const pt = toDevicePoint(g.x, g.y)
      if (pt) {
        onGesture([
          { type: 'pointerMove', duration: 0, x: pt.x, y: pt.y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 50 },
          { type: 'pointerUp', button: 0 },
        ])
      }
    }
  }, [toDevicePoint, onGesture])

  return { onMouseDown, onMouseMove, onMouseUp }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a W3C pointer action sequence from the actual recorded drag path.
 * Uses Ramer-Douglas-Peucker to simplify the path to ≤ MAX_WAYPOINTS,
 * preserving curves and direction changes. Duration per segment is derived
 * from the real timestamps so the playback speed matches the user's gesture.
 */
function buildActionsFromTrack(
  track: TrackPoint[],
  toDevice: (x: number, y: number) => Point | null,
): Record<string, unknown>[] | null {
  if (track.length < 2) return null

  const simplified = simplifyPath(track, MAX_WAYPOINTS)
  const points = simplified.map((tp) => ({ pt: toDevice(tp.x, tp.y), t: tp.t }))
  // Bail if any point is out of bounds
  if (points.some((p) => !p.pt)) return null

  const first = points[0]
  const actions: Record<string, unknown>[] = [
    { type: 'pointerMove', duration: 0, x: first.pt!.x, y: first.pt!.y },
    { type: 'pointerDown', button: 0 },
  ]

  for (let i = 1; i < points.length; i++) {
    const dt = Math.max(1, points[i].t - points[i - 1].t)
    actions.push({
      type: 'pointerMove',
      duration: dt,
      x: points[i].pt!.x,
      y: points[i].pt!.y,
    })
  }

  actions.push({ type: 'pointerUp', button: 0 })
  return actions
}

/**
 * Ramer-Douglas-Peucker path simplification.
 * Reduces a dense mouse track to at most `maxPoints` waypoints while
 * preserving the shape — curves, corners, and direction changes survive.
 */
function simplifyPath(track: TrackPoint[], maxPoints: number): TrackPoint[] {
  if (track.length <= maxPoints) return track

  // Binary search for the right epsilon that yields ≤ maxPoints
  let lo = 0, hi = 500, result = track
  for (let iter = 0; iter < 20; iter++) {
    const eps = (lo + hi) / 2
    result = rdp(track, eps)
    if (result.length > maxPoints) lo = eps
    else hi = eps
  }

  // If still too many, uniformly sample
  if (result.length > maxPoints) {
    const sampled: TrackPoint[] = [track[0]]
    const step = (track.length - 1) / (maxPoints - 1)
    for (let i = 1; i < maxPoints - 1; i++) sampled.push(track[Math.round(i * step)])
    sampled.push(track[track.length - 1])
    return sampled
  }
  return result
}

/** Ramer-Douglas-Peucker core. */
function rdp(points: TrackPoint[], epsilon: number): TrackPoint[] {
  if (points.length <= 2) return points

  const first = points[0], last = points[points.length - 1]
  let maxDist = 0, maxIdx = 0

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], first, last)
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }

  if (maxDist <= epsilon) return [first, last]

  const left = rdp(points.slice(0, maxIdx + 1), epsilon)
  const right = rdp(points.slice(maxIdx), epsilon)
  return [...left.slice(0, -1), ...right]
}

function perpendicularDist(p: TrackPoint, a: TrackPoint, b: TrackPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  const num = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x)
  return num / Math.sqrt(lenSq)
}
