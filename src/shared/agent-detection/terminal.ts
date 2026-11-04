// The part of an xterm Terminal agent detection uses. Both @xterm/xterm (the
// renderer) and @xterm/headless (the PTY daemon) satisfy it.

export interface DetectableTerminal {
  parser: {
    registerOscHandler(ident: number, callback: (data: string) => boolean): { dispose(): void }
  }
  onTitleChange(listener: (title: string) => void): { dispose(): void }
  buffer: {
    active: {
      length: number
      getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined
    }
  }
}
