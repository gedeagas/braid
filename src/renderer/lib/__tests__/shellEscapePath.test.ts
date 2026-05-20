import { describe, it, expect } from 'vitest'
import { shellEscapePath } from '../shellEscapePath'

describe('shellEscapePath', () => {
  it('returns plain alphanumeric paths unchanged', () => {
    expect(shellEscapePath('/Users/dev/project/src/main.ts')).toBe('/Users/dev/project/src/main.ts')
  })

  it('allows dots, underscores, hyphens, colons, and at-signs unquoted', () => {
    expect(shellEscapePath('/tmp/my_file-v2.0.txt')).toBe('/tmp/my_file-v2.0.txt')
    expect(shellEscapePath('@scope/package')).toBe('@scope/package')
  })

  it('wraps paths with spaces in single quotes', () => {
    expect(shellEscapePath('/Users/dev/my project/file.ts')).toBe("'/Users/dev/my project/file.ts'")
  })

  it('escapes embedded single quotes', () => {
    // '/tmp/it'\''s a file' — close quote, escaped literal quote, reopen quote
    expect(shellEscapePath("/tmp/it's a file")).toBe("'/tmp/it'\\''s a file'")
  })

  it('wraps paths with shell metacharacters', () => {
    expect(shellEscapePath('/tmp/$(whoami).txt')).toBe("'/tmp/$(whoami).txt'")
    expect(shellEscapePath('/tmp/file;rm -rf /')).toBe("'/tmp/file;rm -rf /'")
    expect(shellEscapePath('/tmp/file`cmd`')).toBe("'/tmp/file`cmd`'")
  })

  it('wraps paths with parentheses and brackets', () => {
    expect(shellEscapePath('/tmp/photo (1).jpg')).toBe("'/tmp/photo (1).jpg'")
    expect(shellEscapePath('/tmp/[draft].md')).toBe("'/tmp/[draft].md'")
  })

  it('wraps paths with hash, ampersand, and pipe', () => {
    expect(shellEscapePath('/tmp/C# project')).toBe("'/tmp/C# project'")
    expect(shellEscapePath('/tmp/a&b')).toBe("'/tmp/a&b'")
    expect(shellEscapePath('/tmp/a|b')).toBe("'/tmp/a|b'")
  })
})
