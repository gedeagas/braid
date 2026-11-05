// Per-terminal listener registries for external consumers of PTY events (the
// mobile companion server). Shared by the daemon adapter and PtyService.
// Listeners always get every byte, whichever terminals the desktop shows.

type DataCb = (ptyId: string, data: string) => void
type ExitCb = (ptyId: string, exitCode: number) => void
type ResizeCb = (ptyId: string, cols: number, rows: number) => void

function subscribe<T>(map: Map<string, Set<T>>, id: string, cb: T): () => void {
  let set = map.get(id)
  if (!set) {
    set = new Set()
    map.set(id, set)
  }
  set.add(cb)
  return () => { map.get(id)?.delete(cb) }
}

export class PtyListeners {
  private data = new Map<string, Set<DataCb>>()
  private exit = new Map<string, Set<ExitCb>>()
  private resize = new Map<string, Set<ResizeCb>>()

  onData(id: string, cb: DataCb): () => void { return subscribe(this.data, id, cb) }
  onExit(id: string, cb: ExitCb): () => void { return subscribe(this.exit, id, cb) }
  onResize(id: string, cb: ResizeCb): () => void { return subscribe(this.resize, id, cb) }

  emitData(id: string, data: string): void {
    for (const cb of this.data.get(id) ?? []) cb(id, data)
  }

  emitExit(id: string, exitCode: number): void {
    for (const cb of this.exit.get(id) ?? []) cb(id, exitCode)
  }

  emitResize(id: string, cols: number, rows: number): void {
    for (const cb of this.resize.get(id) ?? []) cb(id, cols, rows)
  }

  /** Drop every listener for a terminal that ended. */
  clear(id: string): void {
    this.data.delete(id)
    this.exit.delete(id)
    this.resize.delete(id)
  }
}
