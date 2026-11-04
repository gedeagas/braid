// Design Mode: pointer-to-code element picker. The picker UI runs in the
// automation isolated world; framework source lookup must run in the main
// world (React/Vue/Svelte metadata lives on page-world JS objects).
import type { WebContents } from 'electron'
import type { DesignModeCapture, DesignModeSource } from '../../../shared/browser'
import { AUTOMATION_WORLD_ID } from './automation/pageScripts'
import { captureGuestPng } from './cdp'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatDesignCapture } from '../../../shared/designMode'

const PICKER_SCRIPT = `new Promise((resolve) => {
  if (window.__braidPickerCancel) window.__braidPickerCancel();
  const host = document.createElement('braid-design-picker');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = '<style>.box{position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:2px;transition:all 60ms ease-out;pointer-events:none}.tag{position:fixed;font:11px/1.4 -apple-system,system-ui,sans-serif;color:#fff;background:#3b82f6;padding:1px 6px;border-radius:3px;white-space:nowrap;pointer-events:none}</style><div class="box"></div><div class="tag"></div>';
  const box = root.querySelector('.box');
  const tag = root.querySelector('.tag');
  document.documentElement.appendChild(host);
  let current = null;
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
  const show = (el) => {
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    tag.textContent = label(el) + '  ' + Math.round(r.width) + '\\u00d7' + Math.round(r.height);
    Object.assign(tag.style, { left: Math.max(0, r.left) + 'px', top: (r.top > 20 ? r.top - 20 : r.bottom + 4) + 'px' });
  };
  const onMove = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); if (el && el !== host) show(el); };
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const finish = (value) => {
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('mousedown', swallow, true);
    removeEventListener('mouseup', swallow, true);
    removeEventListener('keydown', onKey, true);
    host.remove();
    window.__braidPickerCancel = null;
    resolve(value);
  };
  const cssPath = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const cls = [...node.classList].filter((c) => !/^(css|sc|jsx|svelte)-/.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const parent = node.parentElement;
      if (parent) { const same = [...parent.children].filter((c) => c.tagName === node.tagName); if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'; }
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const STYLE_KEYS = ['display','position','width','height','margin','padding','gap','flex-direction','justify-content','align-items','grid-template-columns','color','background-color','background-image','font-family','font-size','font-weight','line-height','letter-spacing','text-align','text-transform','border','border-radius','box-shadow','opacity','z-index','overflow','cursor','transition'];
  const capture = (el) => {
    const cs = getComputedStyle(el);
    const styles = {};
    for (const k of STYLE_KEYS) { const v = cs.getPropertyValue(k); if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') styles[k] = v; }
    const r = el.getBoundingClientRect();
    const clip = (s, n) => s.length > n ? s.slice(0, n) + '\\n<!-- \\u2026 truncated -->' : s;
    let neighborhood = '';
    const parent = el.parentElement;
    if (parent) {
      const shallow = parent.cloneNode(false);
      for (const child of [...parent.children].slice(0, 20)) {
        const c = child.cloneNode(false);
        if (child === el) c.setAttribute('data-picked', '');
        c.textContent = child.children.length ? '\\u2026' : (child.textContent || '').trim().slice(0, 40);
        shallow.appendChild(c);
      }
      neighborhood = clip(shallow.outerHTML, 2500);
    }
    el.setAttribute('data-braid-picked', '');
    return {
      url: location.href,
      selector: cssPath(el),
      tagName: el.tagName.toLowerCase(),
      outerHTML: clip(el.outerHTML, 5000),
      neighborhood,
      styles,
      rect: { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.ceil(r.width), height: Math.ceil(r.height) },
    };
  };
  const onClick = (e) => { swallow(e); const el = current || document.elementFromPoint(e.clientX, e.clientY); finish(el ? capture(el) : null); };
  const onKey = (e) => { if (e.key === 'Escape') { swallow(e); finish(null); } };
  addEventListener('mousemove', onMove, true);
  addEventListener('mousedown', swallow, true);
  addEventListener('mouseup', swallow, true);
  addEventListener('click', onClick, true);
  addEventListener('keydown', onKey, true);
  window.__braidPickerCancel = () => finish(null);
})`

const CANCEL_SCRIPT = `window.__braidPickerCancel ? (window.__braidPickerCancel(), true) : false`

// Runs in the page's main world. Best-effort: dev builds expose source
// locations through plugin data attributes or framework internals.
const SOURCE_SCRIPT = `(() => {
  const el = document.querySelector('[data-braid-picked]');
  if (!el) return null;
  el.removeAttribute('data-braid-picked');
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const path = node.getAttribute('data-inspector-relative-path');
    if (path) return { file: path, line: Number(node.getAttribute('data-inspector-line')) || undefined, column: Number(node.getAttribute('data-inspector-column')) || undefined, framework: 'react' };
    const src = node.getAttribute('data-source') || node.getAttribute('data-source-loc');
    if (src) { const m = src.match(/^(.*?):(\\d+)(?::(\\d+))?$/); if (m) return { file: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined, framework: 'unknown' }; }
  }
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (fiberKey) {
    for (let f = el[fiberKey]; f; f = f.return) {
      const s = f._debugSource;
      if (s && s.fileName) return { file: s.fileName, line: s.lineNumber, column: s.columnNumber, framework: 'react' };
      const stack = f._debugStack && f._debugStack.stack;
      if (stack) {
        const frame = stack.split('\\n').map((l) => l.match(/\\(?((?:https?|file):\\/\\/[^\\s)]+?):(\\d+):(\\d+)\\)?$/)).find((m) => m && !/node_modules|react-dom|react\\.development|jsx-dev-runtime|\\/@vite\\/|chunk-/.test(m[1]));
        if (frame) { let file = frame[1]; try { file = decodeURIComponent(new URL(file).pathname).replace(/\\?.*$/, ''); } catch {} return { file, line: Number(frame[2]), column: Number(frame[3]), framework: 'react' }; }
      }
    }
  }
  for (let node = el; node; node = node.parentElement) {
    const vue = node.__vueParentComponent;
    if (vue && vue.type && vue.type.__file) return { file: vue.type.__file, framework: 'vue' };
    if (node.__vue__ && node.__vue__.$options && node.__vue__.$options.__file) return { file: node.__vue__.$options.__file, framework: 'vue' };
    const svelte = node.__svelte_meta;
    if (svelte && svelte.loc) return { file: svelte.loc.file, line: svelte.loc.line + 1, column: svelte.loc.column + 1, framework: 'svelte' };
  }
  return null;
})()`

type PickResult = Omit<DesignModeCapture, 'screenshotBase64' | 'source'>

/** Let the user pick an element; resolves null when cancelled (Esc / toggle off). */
export async function pickElement(wc: WebContents): Promise<DesignModeCapture | null> {
  const picked = await wc.executeJavaScriptInIsolatedWorld(AUTOMATION_WORLD_ID, [{ code: PICKER_SCRIPT }], true) as PickResult | null
  if (!picked) return null
  const source = await wc.executeJavaScript(SOURCE_SCRIPT).catch(() => null) as DesignModeSource | null
  let screenshotBase64: string | null = null
  if (picked.rect.width > 0 && picked.rect.height > 0) {
    // Let the overlay removal paint before capturing.
    await new Promise((r) => setTimeout(r, 80))
    screenshotBase64 = await captureGuestPng(wc, picked.rect).catch(() => null)
  }
  return { ...picked, screenshotBase64, source }
}

/** Persist a pick for terminal agents: element.md (+ element.png) in a fresh temp folder. */
export function saveCapture(capture: DesignModeCapture): { mdPath: string; pngPath: string | null } {
  const dir = mkdtempSync(join(tmpdir(), 'braid-design-'))
  let pngPath: string | null = null
  if (capture.screenshotBase64) {
    pngPath = join(dir, 'element.png')
    writeFileSync(pngPath, Buffer.from(capture.screenshotBase64, 'base64'))
  }
  const mdPath = join(dir, 'element.md')
  writeFileSync(mdPath, formatDesignCapture(capture, pngPath ?? undefined))
  return { mdPath, pngPath }
}

export async function cancelPick(wc: WebContents): Promise<void> {
  await wc.executeJavaScriptInIsolatedWorld(AUTOMATION_WORLD_ID, [{ code: CANCEL_SCRIPT }]).catch(() => {})
}
