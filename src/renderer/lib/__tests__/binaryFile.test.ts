import { describe, it, expect } from 'vitest'
import {
  isBinaryFile,
  isImageFile,
  imageMimeType,
  isGitBinaryDiff,
  binaryTypeLabel,
  formatFileSize,
} from '../binaryFile'

describe('binaryFile', () => {
  describe('isBinaryFile', () => {
    it('returns true for image files', () => {
      expect(isBinaryFile('logo.png')).toBe(true)
      expect(isBinaryFile('photo.jpg')).toBe(true)
      expect(isBinaryFile('photo.jpeg')).toBe(true)
      expect(isBinaryFile('anim.gif')).toBe(true)
      expect(isBinaryFile('icon.webp')).toBe(true)
      expect(isBinaryFile('icon.svg')).toBe(true)
      expect(isBinaryFile('icon.ico')).toBe(true)
      expect(isBinaryFile('photo.avif')).toBe(true)
    })

    it('returns true for font files', () => {
      expect(isBinaryFile('font.woff')).toBe(true)
      expect(isBinaryFile('font.woff2')).toBe(true)
      expect(isBinaryFile('font.ttf')).toBe(true)
      expect(isBinaryFile('font.otf')).toBe(true)
    })

    it('returns true for archive files', () => {
      expect(isBinaryFile('archive.zip')).toBe(true)
      expect(isBinaryFile('archive.tar')).toBe(true)
      expect(isBinaryFile('archive.gz')).toBe(true)
    })

    it('returns true for compiled files', () => {
      expect(isBinaryFile('module.wasm')).toBe(true)
      expect(isBinaryFile('lib.so')).toBe(true)
      expect(isBinaryFile('lib.dylib')).toBe(true)
    })

    it('returns false for text files', () => {
      expect(isBinaryFile('app.tsx')).toBe(false)
      expect(isBinaryFile('README.md')).toBe(false)
      expect(isBinaryFile('style.css')).toBe(false)
      expect(isBinaryFile('data.json')).toBe(false)
      expect(isBinaryFile('script.py')).toBe(false)
    })

    it('returns false for files with no extension', () => {
      expect(isBinaryFile('Makefile')).toBe(false)
      expect(isBinaryFile('.gitignore')).toBe(false)
    })

    it('handles nested paths', () => {
      expect(isBinaryFile('src/assets/logo.png')).toBe(true)
      expect(isBinaryFile('deep/nested/path/font.woff2')).toBe(true)
      expect(isBinaryFile('src/components/App.tsx')).toBe(false)
    })

    it('is case-insensitive for extensions', () => {
      expect(isBinaryFile('LOGO.PNG')).toBe(true)
      expect(isBinaryFile('Photo.JPG')).toBe(true)
    })
  })

  describe('isImageFile', () => {
    it('returns true for image extensions', () => {
      expect(isImageFile('logo.png')).toBe(true)
      expect(isImageFile('photo.jpg')).toBe(true)
      expect(isImageFile('icon.svg')).toBe(true)
      expect(isImageFile('anim.gif')).toBe(true)
      expect(isImageFile('photo.webp')).toBe(true)
      expect(isImageFile('photo.bmp')).toBe(true)
      expect(isImageFile('photo.tiff')).toBe(true)
      expect(isImageFile('photo.avif')).toBe(true)
    })

    it('returns false for non-image binary files', () => {
      expect(isImageFile('font.woff')).toBe(false)
      expect(isImageFile('archive.zip')).toBe(false)
      expect(isImageFile('video.mp4')).toBe(false)
      expect(isImageFile('doc.pdf')).toBe(false)
    })

    it('returns false for text files', () => {
      expect(isImageFile('app.tsx')).toBe(false)
      expect(isImageFile('README.md')).toBe(false)
    })
  })

  describe('imageMimeType', () => {
    it('returns correct MIME types for common images', () => {
      expect(imageMimeType('logo.png')).toBe('image/png')
      expect(imageMimeType('photo.jpg')).toBe('image/jpeg')
      expect(imageMimeType('photo.jpeg')).toBe('image/jpeg')
      expect(imageMimeType('anim.gif')).toBe('image/gif')
      expect(imageMimeType('icon.webp')).toBe('image/webp')
      expect(imageMimeType('icon.svg')).toBe('image/svg+xml')
      expect(imageMimeType('icon.ico')).toBe('image/x-icon')
      expect(imageMimeType('photo.bmp')).toBe('image/bmp')
      expect(imageMimeType('photo.tiff')).toBe('image/tiff')
      expect(imageMimeType('photo.avif')).toBe('image/avif')
    })

    it('returns null for non-image files', () => {
      expect(imageMimeType('font.woff')).toBeNull()
      expect(imageMimeType('app.tsx')).toBeNull()
      expect(imageMimeType('README')).toBeNull()
    })
  })

  describe('isGitBinaryDiff', () => {
    it('detects "Binary files differ" message', () => {
      expect(isGitBinaryDiff('Binary files a/logo.png and b/logo.png differ')).toBe(true)
      expect(isGitBinaryDiff('Binary files /dev/null and b/new.png differ')).toBe(true)
    })

    it('detects "GIT binary patch" marker', () => {
      expect(isGitBinaryDiff('diff --git a/file.png b/file.png\nGIT binary patch\nliteral 1234')).toBe(true)
    })

    it('returns false for normal diffs', () => {
      expect(isGitBinaryDiff('@@ -1,3 +1,4 @@\n+new line\n context')).toBe(false)
      expect(isGitBinaryDiff('')).toBe(false)
    })

    it('detects binary message even with surrounding content', () => {
      const output = 'diff --git a/img.png b/img.png\nindex abc..def 100644\nBinary files a/img.png and b/img.png differ'
      expect(isGitBinaryDiff(output)).toBe(true)
    })
  })

  describe('binaryTypeLabel', () => {
    it('returns correct i18n keys for known types', () => {
      expect(binaryTypeLabel('font.woff2')).toBe('binaryType.font')
      expect(binaryTypeLabel('song.mp3')).toBe('binaryType.audio')
      expect(binaryTypeLabel('video.mp4')).toBe('binaryType.video')
      expect(binaryTypeLabel('file.zip')).toBe('binaryType.archive')
      expect(binaryTypeLabel('doc.pdf')).toBe('binaryType.document')
      expect(binaryTypeLabel('sheet.xlsx')).toBe('binaryType.spreadsheet')
      expect(binaryTypeLabel('module.wasm')).toBe('binaryType.wasm')
      expect(binaryTypeLabel('data.sqlite')).toBe('binaryType.database')
    })

    it('returns fallback key for unknown binary extensions', () => {
      expect(binaryTypeLabel('file.xyz')).toBe('binaryType.binary')
      expect(binaryTypeLabel('noext')).toBe('binaryType.binary')
    })
  })

  describe('formatFileSize', () => {
    it('formats bytes', () => {
      expect(formatFileSize(0)).toBe('0 B')
      expect(formatFileSize(512)).toBe('512 B')
      expect(formatFileSize(1023)).toBe('1023 B')
    })

    it('formats kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB')
      expect(formatFileSize(1536)).toBe('1.5 KB')
      expect(formatFileSize(100 * 1024)).toBe('100.0 KB')
    })

    it('formats megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
    })
  })
})
