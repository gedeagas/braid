import type React from 'react'
import { modifierFromEvent, openLink } from './browser/linkRouter'

/** Prevent default and open a URL per the browser link-routing setting (Braid browser or system). */
export function openExternalLink(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault()
  openLink(href, { modifier: modifierFromEvent(e) })
}
