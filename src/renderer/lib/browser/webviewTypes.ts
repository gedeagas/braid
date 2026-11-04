/**
 * The subset of Electron's <webview> element API browser tabs use.
 * Declared locally because importing `electron` types into the renderer
 * pulls Electron's global DOM overloads into the web tsconfig.
 */
export interface BrowserWebview extends HTMLWebViewElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  isLoading(): boolean
  stop(): void
  reload(): void
  reloadIgnoringCache(): void
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  openDevTools(): void
  closeDevTools(): void
  isDevToolsOpened(): boolean
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  executeJavaScript<T = unknown>(code: string): Promise<T>
  getWebContentsId(): number
}

/** Event detail shapes for the <webview> DOM events browser tabs listen to. */
export interface WebviewNavigateEvent extends Event { url: string; isMainFrame?: boolean }
export interface WebviewTitleEvent extends Event { title: string }
export interface WebviewFaviconEvent extends Event { favicons: string[] }
export interface WebviewFailLoadEvent extends Event { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean }
export interface WebviewFoundInPageEvent extends Event { result: { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean } }
