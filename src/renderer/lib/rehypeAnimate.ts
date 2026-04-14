// ---------------------------------------------------------------------------
// Rehype plugin that wraps text nodes in animated <span> elements for
// smooth word-by-word streaming.
//
// Regular text (paragraphs, lists, headings, blockquotes) is animated
// word-by-word. Block-level elements (code blocks, tables, SVG, math)
// and inline <code> receive a single fade on the container element so
// they animate consistently without breaking internal structure.
//
// Each animated node gets a [data-sd-animate] attribute with CSS custom
// properties controlling animation name, duration, easing, and staggered
// delay. Already-rendered characters get duration=0ms to avoid
// re-animating.
// ---------------------------------------------------------------------------

import type { Element, Node, Parent, Root, Text } from 'hast'
import { visitParents } from 'unist-util-visit-parents'

export interface AnimateOptions {
  animation?: 'fadeIn' | 'blurIn' | 'slideUp' | (string & {})
  duration?: number
  easing?: string
  sep?: 'word' | 'char'
  stagger?: number
}

export interface AnimatePlugin {
  /** Returns char count from the last rehype run. */
  getLastRenderCharCount: () => number
  rehypePlugin: () => (tree: Root) => void
  /** Set the number of characters already rendered (they get duration=0). */
  setPrevContentLength: (length: number) => void
}

const WHITESPACE_RE = /\s/
const WHITESPACE_ONLY_RE = /^\s+$/

/** Block-level elements animated as a single unit (no word wrapping inside). */
const BLOCK_ANIMATE_TAGS = new Set(['pre', 'svg', 'math', 'table'])

const isElement = (node: unknown): node is Element =>
  typeof node === 'object' && node !== null && 'type' in node && (node as Element).type === 'element'

/** Find the nearest block-animate ancestor (pre, svg, math, table). */
function findBlockAncestor(ancestors: Node[]): Element | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i]
    if (isElement(a) && BLOCK_ANIMATE_TAGS.has(a.tagName)) return a
  }
  return null
}

/**
 * Find an inline `<code>` ancestor that is NOT inside a `<pre>`.
 * Code inside `<pre>` is handled by block-level animation instead.
 */
function findInlineCodeAncestor(ancestors: Node[]): Element | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i]
    if (!isElement(a)) continue
    if (BLOCK_ANIMATE_TAGS.has(a.tagName)) return null
    if (a.tagName === 'code') return a
  }
  return null
}

/** Apply animation CSS custom properties directly to an element node. */
function applyElementAnimation(
  el: Element,
  animation: string,
  duration: number,
  easing: string,
  skip: boolean,
  delay: number,
): void {
  const vars = `--sd-animation:sd-${animation};--sd-duration:${skip ? 0 : duration}ms;--sd-easing:${easing}${delay ? `;--sd-delay:${delay}ms` : ''}`
  el.properties = el.properties || {}
  el.properties['data-sd-animate'] = true
  const existing = el.properties.style
  el.properties.style = typeof existing === 'string' && existing ? `${existing};${vars}` : vars
}

function splitByWord(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let inWs = false

  for (const ch of text) {
    const ws = WHITESPACE_RE.test(ch)
    if (ws !== inWs && current) {
      parts.push(current)
      current = ''
    }
    current += ch
    inWs = ws
  }
  if (current) parts.push(current)
  return parts
}

function splitByChar(text: string): string[] {
  const parts: string[] = []
  let wsBuf = ''

  for (const ch of text) {
    if (WHITESPACE_RE.test(ch)) {
      wsBuf += ch
    } else {
      if (wsBuf) { parts.push(wsBuf); wsBuf = '' }
      parts.push(ch)
    }
  }
  if (wsBuf) parts.push(wsBuf)
  return parts
}

function makeSpan(
  word: string,
  animation: string,
  duration: number,
  easing: string,
  skipAnimation: boolean,
  delay: number,
): Element {
  let style = `--sd-animation:sd-${animation};--sd-duration:${skipAnimation ? 0 : duration}ms;--sd-easing:${easing}`
  if (delay) style += `;--sd-delay:${delay}ms`

  return {
    type: 'element',
    tagName: 'span',
    properties: { 'data-sd-animate': true, style },
    children: [{ type: 'text', value: word }],
  }
}

interface RenderState {
  lastRenderCharCount: number
  prevContentLength: number
}

interface AnimateConfig {
  animation: string
  duration: number
  easing: string
  sep: 'word' | 'char'
  stagger: number
}

let instanceId = 0

/**
 * Create a rehype animate plugin instance.
 *
 * Text in regular elements (paragraphs, lists, headings) is animated
 * word-by-word. Block elements (code blocks, tables, SVG, math) and
 * inline `<code>` receive a single fade on the container element so
 * they animate consistently without breaking internal structure.
 */
export function createAnimatePlugin(options?: AnimateOptions): AnimatePlugin {
  const config: AnimateConfig = {
    animation: options?.animation ?? 'fadeIn',
    duration: options?.duration ?? 150,
    easing: options?.easing ?? 'ease',
    sep: options?.sep ?? 'word',
    stagger: options?.stagger ?? 40,
  }

  const state: RenderState = {
    prevContentLength: 0,
    lastRenderCharCount: 0,
  }

  const id = instanceId++

  const rehypeAnimate = () => (tree: Root) => {
    const counter = { count: 0, newIndex: 0 }
    const markedElements = new Set<Element>()
    const prevLen = state.prevContentLength

    visitParents(tree, 'text', (node: Text, ancestors) => {
      const parent = ancestors[ancestors.length - 1]
      if (!(parent && 'children' in parent)) return

      const text = node.value

      // ---- Block-level ancestor (pre, svg, math, table) ----
      // Animate the container as one unit instead of wrapping words.
      const blockEl = findBlockAncestor(ancestors)
      if (blockEl) {
        const charStart = counter.count
        counter.count += text.length
        if (!markedElements.has(blockEl)) {
          markedElements.add(blockEl)
          const skip = prevLen > 0 && charStart < prevLen
          const delay = skip ? 0 : counter.newIndex++ * config.stagger
          applyElementAnimation(blockEl, config.animation, config.duration, config.easing, skip, delay)
        }
        return
      }

      // ---- Inline <code> (not inside <pre>) ----
      // Animate the <code> element as one unit so it fades in alongside
      // surrounding words without wrapping spans inside the code text.
      const codeEl = findInlineCodeAncestor(ancestors)
      if (codeEl) {
        const charStart = counter.count
        counter.count += text.length
        if (!markedElements.has(codeEl)) {
          markedElements.add(codeEl)
          const skip = prevLen > 0 && charStart < prevLen
          const delay = skip ? 0 : counter.newIndex++ * config.stagger
          applyElementAnimation(codeEl, config.animation, config.duration, config.easing, skip, delay)
        }
        return
      }

      // ---- Regular text - word-by-word animation ----
      const parentNode = parent as Parent
      const index = parentNode.children.indexOf(node)
      if (index === -1) return

      if (!text.trim()) {
        counter.count += text.length
        return
      }

      const parts = config.sep === 'char' ? splitByChar(text) : splitByWord(text)

      const nodes: (Element | Text)[] = parts.map((part) => {
        const partStart = counter.count
        counter.count += part.length
        if (WHITESPACE_ONLY_RE.test(part)) {
          return { type: 'text', value: part } as Text
        }
        const skip = prevLen > 0 && partStart < prevLen
        const delay = skip ? 0 : counter.newIndex++ * config.stagger
        return makeSpan(part, config.animation, config.duration, config.easing, skip, delay)
      })

      parentNode.children.splice(index, 1, ...nodes)
      return index + nodes.length
    })

    state.lastRenderCharCount = counter.count
    state.prevContentLength = 0
  }

  // Unique function name so processor cache creates separate entries per instance
  Object.defineProperty(rehypeAnimate, 'name', { value: `rehypeAnimate$${id}` })

  return {
    rehypePlugin: rehypeAnimate,
    setPrevContentLength(length: number) {
      state.prevContentLength = length
    },
    getLastRenderCharCount() {
      return state.lastRenderCharCount
    },
  }
}
