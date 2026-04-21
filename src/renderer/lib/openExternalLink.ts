import type React from 'react'
import { shell } from './ipc'

/** Prevent default and open a URL in the OS default browser via Electron shell. */
export function openExternalLink(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault()
  shell.openExternal(href)
}
