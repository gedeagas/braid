/** Convert an absolute filesystem path to a file:// URI */
export function pathToFileUri(p: string): string {
  return 'file://' + p.replace(/ /g, '%20')
}

/** Convert a file:// URI back to an absolute filesystem path */
export function fileUriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''))
}

/** Normalize react-flavored language IDs to their base language family */
export function languageFamily(languageId: string): string {
  if (languageId === 'typescriptreact') return 'typescript'
  if (languageId === 'javascriptreact') return 'javascript'
  return languageId
}

/** Map a Monaco languageId to a short display abbreviation */
export function languageAbbrev(languageId: string): string {
  const map: Record<string, string> = {
    typescript: 'TS',
    typescriptreact: 'TSX',
    javascript: 'JS',
    javascriptreact: 'JSX',
    rust: 'RS',
    go: 'Go',
    python: 'Py',
    svelte: 'SV',
    vue: 'VUE',
    html: 'HTML',
    css: 'CSS',
    json: 'JSON',
    swift: 'SW',
  }
  return map[languageId] ?? languageId.slice(0, 3).toUpperCase()
}

/** Map languageId to its brand color */
export function languageColor(languageId: string): string {
  const map: Record<string, string> = {
    typescript: '#3178c6',
    typescriptreact: '#3178c6',
    javascript: '#f7df1e',
    javascriptreact: '#f7df1e',
    rust: '#ce4a21',
    go: '#00acd7',
    python: '#f5c518',
    svelte: '#ff3e00',
    vue: '#42b883',
    swift: '#F05138',
  }
  return map[languageId] ?? 'var(--accent)'
}
