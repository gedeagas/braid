import { describe, it, expect, vi, beforeEach } from 'vitest'
import { compressImage } from '../imageCompression'

// ─── Mock browser APIs ──────────────────────────────────────────────────────

let drawImageSpy: ReturnType<typeof vi.fn>
let toDataURLSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.restoreAllMocks()

  drawImageSpy = vi.fn()
  toDataURLSpy = vi.fn().mockReturnValue('data:image/jpeg;base64,compressed')

  // Mock document.createElement for canvas
  const origCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: drawImageSpy }),
        toDataURL: toDataURLSpy,
      } as unknown as HTMLCanvasElement
    }
    return origCreate(tag)
  })

  // Mock URL.createObjectURL / revokeObjectURL (preserve constructor)
  globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock')
  globalThis.URL.revokeObjectURL = vi.fn()

  // Mock Image constructor
  vi.stubGlobal(
    'Image',
    class MockImage {
      width = 2048
      height = 1536
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      private _src = ''
      get src() {
        return this._src
      }
      set src(url: string) {
        this._src = url
        setTimeout(() => this.onload?.(), 0)
      }
    },
  )

  // Mock FileReader - returns data URI matching the file's MIME type
  vi.stubGlobal(
    'FileReader',
    class MockFileReader {
      result: string | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(file: File) {
        const mime = file.type || 'application/octet-stream'
        this.result = `data:${mime};base64,` + 'A'.repeat(10000)
        setTimeout(() => this.onload?.(), 0)
      }
    },
  )
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('compressImage', () => {
  it('compresses a large PNG to JPEG and resizes to fit 1024px', async () => {
    const file = new File(['fake'], 'screenshot.png', { type: 'image/png' })

    const result = await compressImage(file)

    expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.65)
    expect(result).toBe('data:image/jpeg;base64,compressed')
  })

  it('compresses GIF to JPEG (Claude only sees first frame)', async () => {
    const file = new File(['fake'], 'animation.gif', { type: 'image/gif' })

    const result = await compressImage(file)

    expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.65)
    expect(result).toBe('data:image/jpeg;base64,compressed')
  })

  it('re-encodes small images without resizing', async () => {
    // Override Image mock to simulate a small image
    vi.stubGlobal(
      'Image',
      class SmallImage {
        width = 400
        height = 300
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        private _src = ''
        get src() { return this._src }
        set src(url: string) {
          this._src = url
          setTimeout(() => this.onload?.(), 0)
        }
      },
    )

    const file = new File(['fake'], 'small.png', { type: 'image/png' })
    const result = await compressImage(file)

    // Should still JPEG-encode but at original dimensions (no resize)
    expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.65)
    expect(result).toBe('data:image/jpeg;base64,compressed')
  })

  it('keeps original when compressed is larger', async () => {
    // File content is 4 bytes, estimated data URI ~36 chars.
    // Make compressed result much larger than that estimate.
    toDataURLSpy.mockReturnValue('data:image/jpeg;base64,' + 'B'.repeat(200))

    const file = new File(['fake'], 'tiny.png', { type: 'image/png' })
    const result = await compressImage(file)

    // Should fall back to original FileReader result
    expect(result).toContain('data:image/png;base64,AAAA')
  })
})
