import { useState, useCallback, useRef, useEffect } from 'react'

/** Copies text to clipboard on click, with a 2s "copied" feedback state. */
export function useCopyToClipboard(text: string) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).catch((err) => {
      console.error('Failed to copy to clipboard:', err)
    })
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }, [text])

  return { copied, handleCopy }
}
