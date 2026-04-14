// ---------------------------------------------------------------------------
// Singleton lazy Shiki highlighter for diff syntax highlighting.
// Uses the CSS Variables theme so token colors come from existing --hljs-*
// design tokens, keeping the app's theme system in control.
// ---------------------------------------------------------------------------

import {
  createHighlighter, createCssVariablesTheme,
  type HighlighterGeneric, type BundledLanguage, type BundledTheme,
} from 'shiki'

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

const SUPPORTED_LANGS: BundledLanguage[] = [
  'typescript', 'tsx', 'javascript', 'jsx',
  'json', 'css', 'scss',
  'python', 'go', 'rust',
  'xml', 'html', 'sql',
  'bash',
  'markdown', 'yaml', 'toml',
  'swift', 'kotlin', 'java', 'ruby',
  'c', 'cpp',
]

// Shiki v4 removed the bundled "css-variables" theme. Create it manually
// so token colors are driven by CSS custom properties (mapped in shiki.css).
const cssVarsTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  variableDefaults: {},
})

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [cssVarsTheme],
      langs: SUPPORTED_LANGS,
    }).catch((err) => {
      // Clear cached promise so next call retries instead of returning
      // the same rejection forever.
      highlighterPromise = null
      throw err
    })
  }
  return highlighterPromise
}

// ── File extension -> Shiki language ID ──────────────────────────────────────

const EXT_LANG: Record<string, BundledLanguage> = {
  ts: 'typescript', tsx: 'tsx',
  js: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss',
  py: 'python',
  go: 'go',
  rs: 'rust',
  xml: 'xml', svg: 'xml', html: 'html',
  sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  md: 'markdown', mdx: 'markdown',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  java: 'java',
  rb: 'ruby',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
}

/** Returns a Shiki language name for the given file path, or null if unsupported. */
export function extToShikiLang(filePath: string): BundledLanguage | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext] ?? null
}

// ── Highlight code -> per-line HTML array ────────────────────────────────────

/**
 * Highlight a block of code and return an array of HTML strings, one per line.
 * Uses the CSS Variables theme so colors are controlled by --shiki-* vars
 * (mapped to --hljs-* in shiki.css).
 */
export async function highlightLines(code: string, lang: BundledLanguage): Promise<string[]> {
  const hl = await getHighlighter()
  const html = hl.codeToHtml(code, { lang, theme: 'css-variables' })
  // codeToHtml wraps output in <pre class="shiki ..."><code><span class="line">...</span>\n...</code></pre>
  // Extract inner content, then split by the line wrapper tags.
  const inner = html
    .replace(/^<pre[^>]*><code>/, '')
    .replace(/<\/code><\/pre>$/, '')
  // Shiki wraps each line in <span class="line">...</span> (inner content has nested spans).
  // Split on the opening tag, then strip the trailing </span> from each segment.
  const LINE_TAG = '<span class="line">'
  const segments = inner.split(LINE_TAG).slice(1) // skip empty prefix
  if (segments.length === 0) return inner.split('\n')
  return segments.map((seg) => seg.replace(/<\/span>\s*$/, ''))
}
