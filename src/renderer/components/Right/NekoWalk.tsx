import { useEffect, useRef, useState } from 'react'

// 6-frame walk cycle: ears/tail/paws all shift each frame
const WALK_FRAMES = [
  // frame 0 – stride right, tail up-right
  [
    ' /\\_/\\  ',
    '( ^ω^ ) ',
    ' >  ♡<  ',
    ' /|     ',
    '  |  ∫  ',
  ],
  // frame 1 – mid stride, tail level
  [
    ' /\\_/\\  ',
    '( ^ω^ ) ',
    ' > ♡ <  ',
    '  ╰─╯   ',
    ' ∫    ∫ ',
  ],
  // frame 2 – stride left, tail up-left
  [
    ' /\\_/\\  ',
    '( ^ω^ ) ',
    '  >♡ <  ',
    '     |\\ ',
    ' ∫  |   ',
  ],
  // frame 3 – feet together, body dips slightly (bounce low)
  [
    ' /\\_/\\  ',
    '( ^ω^ ) ',
    ' > ♡ <  ',
    '  ╰─╯   ',
    '∫      ∫',
  ],
  // frame 4 – stride right again, ears perk
  [
    ' /\\_/\\  ',
    '( ᵕω^ ) ',
    ' >  ♡<  ',
    ' /|     ',
    '  |  ∫  ',
  ],
  // frame 5 – glide, tail swish
  [
    '  /\\_/\\ ',
    ' ( ^ω^) ',
    '  > ♡ < ',
    '   ╰─╯  ',
    ' ∫    ∫ ',
  ],
]

// Sitting frame shown on mount before the walk starts
const SIT_FRAME = [
  ' /\\_/\\  ',
  '( ^ω^ ) ',
  ' (  ♡ ) ',
  '  ╰─╯   ',
  '  || ||  ',
]

export function NekoWalk() {
  const [lines, setLines] = useState(SIT_FRAME)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameIdx = useRef(0)

  useEffect(() => {
    // Sit for a beat, then start the walk cycle
    timeoutRef.current = setTimeout(() => {
      setLines(WALK_FRAMES[0])
      intervalRef.current = setInterval(() => {
        frameIdx.current = (frameIdx.current + 1) % WALK_FRAMES.length
        setLines(WALK_FRAMES[frameIdx.current])
      }, 150) // snappy per-frame, overall walk speed set by CSS animation duration
    }, 900)

    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
      if (intervalRef.current !== null) clearInterval(intervalRef.current)
    }
  }, [])

  return (
    <div className="neko-walk-wrapper" aria-hidden="true">
      <div className="neko-walk-cat">
        <pre className="neko-pre">{lines.join('\n')}</pre>
      </div>
    </div>
  )
}
