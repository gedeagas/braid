// Decide what happens when a browser page opens a new window.
import { isBrowsableUrl } from '../../../shared/browser'

export type PopupDecision =
  /** Open as a new Braid browser tab (same profile). */
  | { kind: 'tab'; background: boolean }
  /** Real child window sharing the opener's session, so window.opener works (OAuth, payments). */
  | { kind: 'window' }
  /** Hand to the OS (mailto:, tel:, custom app schemes). */
  | { kind: 'external' }
  | { kind: 'deny' }

export interface PopupRequest {
  url: string
  frameName: string
  features: string
  disposition: string
}

const EXTERNAL_SCHEMES = /^(mailto|tel|sms|facetime|slack|zoommtg|vscode|cursor):/i

export function decidePopup(req: PopupRequest): PopupDecision {
  const { url, features, disposition } = req
  const frameName = req.frameName === '_blank' ? '' : req.frameName
  if (EXTERNAL_SCHEMES.test(url)) return { kind: 'external' }
  // Script-driven popups (named target, explicit size, or a blank document the
  // opener will write into) need a live window.opener - give them a real window.
  const blank = url === '' || url === 'about:blank'
  if (disposition === 'new-window' && (frameName !== '' || features !== '' || blank)) {
    return blank || isBrowsableUrl(url) ? { kind: 'window' } : { kind: 'deny' }
  }
  if (!isBrowsableUrl(url) || blank) return { kind: 'deny' }
  return { kind: 'tab', background: disposition === 'background-tab' }
}
