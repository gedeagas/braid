import { describe, expect, it } from 'vitest'
import {
  isHtmlPreviewFile,
  pathToFileUrl,
} from '../htmlPreview'

describe('htmlPreview', () => {
  describe('isHtmlPreviewFile', () => {
    it('detects HTML files case-insensitively', () => {
      expect(isHtmlPreviewFile('/tmp/index.html')).toBe(true)
      expect(isHtmlPreviewFile('/tmp/index.htm')).toBe(true)
      expect(isHtmlPreviewFile('/tmp/INDEX.HTML')).toBe(true)
    })

    it('does not treat other text files as HTML previews', () => {
      expect(isHtmlPreviewFile('/tmp/readme.md')).toBe(false)
      expect(isHtmlPreviewFile('/tmp/component.tsx')).toBe(false)
      expect(isHtmlPreviewFile('/tmp/vector.svg')).toBe(false)
    })
  })

  describe('pathToFileUrl', () => {
    it('builds a file URL for the file', () => {
      expect(pathToFileUrl('/Users/me/site/index.html')).toBe('file:///Users/me/site/index.html')
    })

    it('encodes characters that are unsafe in URLs', () => {
      expect(pathToFileUrl('/Users/me/my site/#demo/index.html')).toBe(
        'file:///Users/me/my%20site/%23demo/index.html'
      )
    })

    it('keeps Windows drive separators valid', () => {
      expect(pathToFileUrl('C:\\Users\\me\\site\\index.html')).toBe(
        'file:///C:/Users/me/site/index.html'
      )
    })
  })
})
