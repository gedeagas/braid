// Scripts injected into browser guests for agent automation. They run in an
// isolated world (page scripts can't see or tamper with them) and talk to the
// page DOM through `data-braid-ref` attributes assigned by the snapshot.

/** Isolated world id for Braid automation scripts (any stable non-zero id). */
export const AUTOMATION_WORLD_ID = 1077

const MAX_SNAPSHOT_LINES = 600

/**
 * Snapshot: assigns refs to visible interactive elements and returns a compact
 * outline (headings, landmarks, interactive elements, short text blocks).
 */
export const SNAPSHOT_SCRIPT = `(() => {
  const MAX = ${MAX_SNAPSHOT_LINES};
  document.querySelectorAll('[data-braid-ref]').forEach((el) => el.removeAttribute('data-braid-ref'));
  const lines = [];
  let n = 0;
  const INTERACTIVE_ROLES = new Set(['button','link','checkbox','radio','switch','tab','menuitem','menuitemcheckbox','menuitemradio','option','combobox','textbox','searchbox','slider','spinbutton','treeitem']);
  const clip = (s, len = 80) => { s = (s || '').replace(/\\s+/g, ' ').trim(); return s.length > len ? s.slice(0, len - 1) + '\\u2026' : s; };
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '); if (t.trim()) return t; }
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l?.innerText.trim()) return l.innerText; }
    const wrap = el.closest('label'); if (wrap && wrap !== el && wrap.innerText.trim()) return wrap.innerText;
    return el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.value || '';
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'hidden') return null;
      if (t === 'checkbox' || t === 'radio') return t;
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      if (t === 'range') return 'slider';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    if (el.isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox';
    return null;
  };
  const describe = (el, role) => {
    const parts = [role, JSON.stringify(clip(nameOf(el)))];
    if ('value' in el && role !== 'button' && el.value) parts.push('value=' + JSON.stringify(clip(String(el.value), 60)));
    if (el.checked) parts.push('checked');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('disabled');
    if (el.getAttribute('aria-expanded')) parts.push('expanded=' + el.getAttribute('aria-expanded'));
    if (el.getAttribute('aria-selected') === 'true') parts.push('selected');
    if (role === 'link') { const href = el.getAttribute('href'); if (href && !href.startsWith('javascript:')) parts.push('href=' + JSON.stringify(clip(href, 100))); }
    return parts.join(' ');
  };
  const walk = (el, depth) => {
    if (lines.length >= MAX) return;
    if (!(el instanceof Element)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'svg') return;
    if (!visible(el)) return;
    const role = roleOf(el);
    const indent = '  '.repeat(Math.min(depth, 8));
    let childDepth = depth;
    if (role && INTERACTIVE_ROLES.has(role)) {
      const ref = 'e' + (++n);
      el.setAttribute('data-braid-ref', ref);
      lines.push(indent + '[' + ref + '] ' + describe(el, role));
      if (role !== 'combobox' && role !== 'textbox') { childDepth++; }
      if (tag === 'select' || tag === 'textarea' || tag === 'input' || role === 'button' || role === 'link') return;
    } else if (/^h[1-6]$/.test(tag)) {
      lines.push(indent + 'heading(' + tag[1] + ') ' + JSON.stringify(clip(el.innerText, 120)));
      return;
    } else if (['nav','main','header','footer','aside','form','dialog'].includes(tag) || ['navigation','main','dialog','alertdialog','form','banner','contentinfo','search'].includes(el.getAttribute('role') || '')) {
      lines.push(indent + (el.getAttribute('role') || tag) + (el.getAttribute('aria-label') ? ' ' + JSON.stringify(clip(el.getAttribute('aria-label'))) : '') + ':');
      childDepth++;
    } else if (tag === 'img' && el.getAttribute('alt')) {
      lines.push(indent + 'img ' + JSON.stringify(clip(el.getAttribute('alt'))));
      return;
    } else if ((tag === 'p' || tag === 'li' || tag === 'td' || tag === 'th' || tag === 'label') && !el.querySelector('a,button,input,select,textarea,[role]')) {
      const text = clip(el.innerText, 120);
      if (text) lines.push(indent + 'text ' + JSON.stringify(text));
      return;
    }
    for (const child of el.children) walk(child, childDepth);
    if (el.shadowRoot) for (const child of el.shadowRoot.children) walk(child, childDepth);
  };
  walk(document.body, 0);
  if (lines.length >= MAX) lines.push('\\u2026 (truncated; scroll or use browser_find to narrow down)');
  return { title: document.title, url: location.href, refs: n, outline: lines.join('\\n') };
})()`

/** Scroll the referenced element into view and return its center (CSS px, viewport coords). */
export function locateScript(ref: string): string {
  return `(() => {
    const el = document.querySelector('[data-braid-ref="${ref.replace(/[^\w-]/g, '')}"]');
    if (!el) return { error: 'Unknown ref ${ref.replace(/[^\w-]/g, '')} - take a new browser_snapshot' };
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height, tag: el.tagName.toLowerCase() };
  })()`
}

/** Focus an element and select its current contents so typed text replaces it. */
export function focusForFillScript(ref: string): string {
  return `(() => {
    const el = document.querySelector('[data-braid-ref="${ref.replace(/[^\w-]/g, '')}"]');
    if (!el) return { error: 'Unknown ref - take a new browser_snapshot' };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.focus();
    if (typeof el.select === 'function') el.select();
    else if (el.isContentEditable) { const range = document.createRange(); range.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
    return { ok: true, tag: el.tagName.toLowerCase() };
  })()`
}

export function selectOptionScript(ref: string, value: string): string {
  return `(() => {
    const el = document.querySelector('[data-braid-ref="${ref.replace(/[^\w-]/g, '')}"]');
    if (!(el instanceof HTMLSelectElement)) return { error: 'Ref is not a <select>' };
    const wanted = ${JSON.stringify(value)};
    const opt = [...el.options].find((o) => o.value === wanted || o.label.trim() === wanted || o.text.trim() === wanted);
    if (!opt) return { error: 'No option matching ' + JSON.stringify(wanted) + '. Options: ' + [...el.options].map((o) => o.label).join(', ') };
    el.value = opt.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, selected: opt.label };
  })()`
}

export function waitConditionScript(text: string | null, selector: string | null): string {
  return `(() => {
    const text = ${JSON.stringify(text)};
    const selector = ${JSON.stringify(selector)};
    if (selector && !document.querySelector(selector)) return false;
    if (text && !(document.body?.innerText || '').includes(text)) return false;
    return true;
  })()`
}

export function elementRectScript(ref: string): string {
  return `(() => {
    const el = document.querySelector('[data-braid-ref="${ref.replace(/[^\w-]/g, '')}"]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.ceil(r.width), height: Math.ceil(r.height) };
  })()`
}
