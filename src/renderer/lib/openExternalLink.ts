import type React from 'react'

/** Prevent default and open a URL in the OS default browser via Electron shell. */
export function openExternalLink(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault()
  window.api.shell.openExternal(href)
}
