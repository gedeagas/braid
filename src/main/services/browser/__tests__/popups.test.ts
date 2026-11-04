import { describe, it, expect } from 'vitest'
import { decidePopup, type PopupRequest } from '../popups'

function req(partial: Partial<PopupRequest>): PopupRequest {
  return { url: 'https://example.com/', frameName: '', features: '', disposition: 'foreground-tab', ...partial }
}

describe('decidePopup', () => {
  it('opens target=_blank links as foreground tabs', () => {
    expect(decidePopup(req({}))).toEqual({ kind: 'tab', background: false })
  })

  it('opens cmd+click links as background tabs', () => {
    expect(decidePopup(req({ disposition: 'background-tab' }))).toEqual({ kind: 'tab', background: true })
  })

  it('opens unnamed window.open calls as tabs', () => {
    expect(decidePopup(req({ disposition: 'new-window' }))).toEqual({ kind: 'tab', background: false })
  })

  it('treats _blank as unnamed', () => {
    expect(decidePopup(req({ disposition: 'new-window', frameName: '_blank' }))).toEqual({ kind: 'tab', background: false })
  })

  it('gives named or sized popups a real window', () => {
    expect(decidePopup(req({ disposition: 'new-window', frameName: 'oauth' }))).toEqual({ kind: 'window' })
    expect(decidePopup(req({ disposition: 'new-window', features: 'width=500,height=600' }))).toEqual({ kind: 'window' })
    expect(decidePopup(req({ disposition: 'new-window', url: 'about:blank' }))).toEqual({ kind: 'window' })
  })

  it('hands app schemes to the OS', () => {
    expect(decidePopup(req({ url: 'mailto:a@b.com' }))).toEqual({ kind: 'external' })
  })

  it('denies unsupported schemes', () => {
    expect(decidePopup(req({ url: 'javascript:alert(1)' }))).toEqual({ kind: 'deny' })
    expect(decidePopup(req({ url: 'chrome://settings', disposition: 'new-window', frameName: 'x' }))).toEqual({ kind: 'deny' })
    expect(decidePopup(req({ url: 'about:blank' }))).toEqual({ kind: 'deny' })
  })
})
