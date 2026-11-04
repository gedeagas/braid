import { describe, it, expect } from 'vitest'
import { formatDesignCapture, designCaptureSummary } from '../designMode'
import type { DesignModeCapture } from '../browser'

const capture: DesignModeCapture = {
  url: 'http://localhost:5173/settings',
  selector: 'main > form > button.primary',
  tagName: 'button',
  outerHTML: '<button class="primary">Save</button>',
  neighborhood: '<form><input><button class="primary" data-picked="">Save</button></form>',
  styles: { color: 'rgb(255, 255, 255)', 'border-radius': '6px' },
  rect: { x: 10, y: 20, width: 80, height: 32 },
  screenshotBase64: null,
  source: { file: 'src/Settings.tsx', line: 42, column: 7, framework: 'react' },
}

describe('formatDesignCapture', () => {
  it('includes location, source, html and styles', () => {
    const md = formatDesignCapture(capture, '/tmp/x/element.png')
    expect(md).toContain('- Selector: `main > form > button.primary`')
    expect(md).toContain('- Source (react): `src/Settings.tsx:42:7`')
    expect(md).toContain('- Screenshot: /tmp/x/element.png')
    expect(md).toContain('<button class="primary">Save</button>')
    expect(md).toContain('border-radius: 6px;')
    expect(md).toContain('data-picked')
  })

  it('omits empty sections', () => {
    const md = formatDesignCapture({ ...capture, source: null, styles: {}, neighborhood: '' })
    expect(md).not.toContain('Source')
    expect(md).not.toContain('Computed styles')
    expect(md).not.toContain('Surrounding markup')
  })
})

describe('designCaptureSummary', () => {
  it('summarizes tag, selector and source', () => {
    expect(designCaptureSummary(capture)).toBe('<button> main > form > button.primary (src/Settings.tsx:42)')
  })
})
