/** Generic localStorage load utilities shared across UI store slices. */

export function loadStr(key: string, fallback: string): string {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return raw
  } catch {}
  return fallback
}

export function loadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return raw === 'true'
  } catch {}
  return fallback
}

export function loadInt(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const n = parseInt(raw, 10)
      if (!isNaN(n)) return n
    }
  } catch {}
  return fallback
}

export function loadFloat(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const n = parseFloat(raw)
      if (!isNaN(n)) return n
    }
  } catch {}
  return fallback
}
