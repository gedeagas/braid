/// <reference types="vite/client" />

declare module 'ansi-to-html' {
  interface Options {
    fg?: string
    bg?: string
    newline?: boolean
    escapeXML?: boolean
    stream?: boolean
    colors?: Record<number, string>
  }
  class Convert {
    constructor(options?: Options)
    toHtml(input: string): string
  }
  export = Convert
}

import type { ElectronAPI } from '../../preload/index'

declare global {
  interface Window {
    api: ElectronAPI
  }
}
