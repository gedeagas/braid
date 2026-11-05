import { memo, useCallback, useEffect, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowserViewport } from '@shared/browser'
import { useBrowserStore } from '@/store/browser'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconCursorClick, IconSmartphone } from '@/components/shared/icons'
import { Button } from '@/components/ui'
import { BROWSER_ICON } from './browserChrome'

export interface ViewportPreset { id: string; viewport: BrowserViewport }

export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: 'iphone', viewport: { width: 393, height: 852, deviceScaleFactor: 3, mobile: true } },
  { id: 'pixel', viewport: { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true } },
  { id: 'ipad', viewport: { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true } },
  { id: 'laptop', viewport: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false } },
  { id: 'desktop', viewport: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false } },
]

interface ViewportState { open: boolean; width: string; height: string }

/** Viewport-size emulation: presets + custom size. */
export const ViewportControl = memo(function ViewportControl({ viewport, disabled, onChange }: {
  viewport: BrowserViewport | undefined
  disabled: boolean
  onChange: (v: BrowserViewport | undefined) => void
}) {
  const { t } = useTranslation('center')
  const [state, patch] = useReducer((s: ViewportState, p: Partial<ViewportState>) => ({ ...s, ...p }), {
    open: false, width: String(viewport?.width ?? 1280), height: String(viewport?.height ?? 800),
  })
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!state.open) return
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) patch({ open: false }) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      patch({ open: false })
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [state.open])

  const pick = useCallback((v: BrowserViewport | undefined) => {
    onChange(v)
    patch({ open: false, ...(v ? { width: String(v.width), height: String(v.height) } : {}) })
  }, [onChange])

  const applyCustom = useCallback(() => {
    const width = Number(state.width)
    const height = Number(state.height)
    if (width >= 200 && height >= 200) pick({ width, height, deviceScaleFactor: 1, mobile: false })
  }, [state.width, state.height, pick])

  const label = viewport ? `${viewport.width}×${viewport.height}` : null
  return (
    <div className="browser-viewport-control" ref={rootRef}>
      <Tooltip content={t('browser.viewport.title')} position="bottom">
        <Button
          size="icon"
          className={`browser-icon-btn${viewport ? ' browser-icon-btn--active browser-icon-btn--labeled' : ''}`}
          aria-label={t('browser.viewport.title')}
          aria-haspopup="menu"
          aria-expanded={state.open}
          disabled={disabled}
          onClick={() => patch({ open: !state.open })}
        >
          <IconSmartphone size={BROWSER_ICON.tool} />
          {label && <span className="browser-viewport-label">{label}</span>}
        </Button>
      </Tooltip>
      {state.open && (
        <div className="browser-popover" role="menu">
          <button className={`browser-popover-item${!viewport ? ' browser-popover-item--active' : ''}`} onClick={() => pick(undefined)}>
            {t('browser.viewport.fill')}
          </button>
          {VIEWPORT_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`browser-popover-item${viewport?.width === p.viewport.width && viewport.height === p.viewport.height ? ' browser-popover-item--active' : ''}`}
              onClick={() => pick(p.viewport)}
            >
              <span>{t(`browser.viewport.${p.id}`)}</span>
              <span className="browser-popover-meta">{p.viewport.width}{'×'}{p.viewport.height}</span>
            </button>
          ))}
          <div className="browser-popover-custom">
            <input className="settings-input" inputMode="numeric" aria-label={t('browser.viewport.width')} value={state.width} onChange={(e) => patch({ width: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') applyCustom() }} />
            <span className="browser-popover-times">{'×'}</span>
            <input className="settings-input" inputMode="numeric" aria-label={t('browser.viewport.height')} value={state.height} onChange={(e) => patch({ height: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') applyCustom() }} />
            <Button size="sm" onClick={applyCustom}>{t('browser.viewport.apply')}</Button>
          </div>
        </div>
      )}
    </div>
  )
})

/** Per-tab profile picker (only shown when more than one profile exists). */
export const ProfilePicker = memo(function ProfilePicker({ profileId, onChange }: { profileId: string; onChange: (id: string) => void }) {
  const { t } = useTranslation('center')
  const profiles = useBrowserStore((s) => s.settings.profiles)
  if (profiles.length < 2) return null
  return (
    <select
      className="settings-select browser-profile-select"
      aria-label={t('browser.profile')}
      title={t('browser.profile')}
      value={profileId}
      onChange={(e) => onChange(e.target.value)}
    >
      {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )
})

export const DesignModeToggle = memo(function DesignModeToggle({ active, disabled, onToggle }: { active: boolean; disabled: boolean; onToggle: () => void }) {
  const { t } = useTranslation('center')
  return (
    <Tooltip content={active ? t('browser.designModeOn') : t('browser.designMode')} position="bottom">
      <Button
        size="icon"
        className={`browser-icon-btn${active ? ' browser-icon-btn--active' : ''}`}
        aria-label={t('browser.designMode')}
        aria-pressed={active}
        disabled={disabled}
        onClick={onToggle}
      >
        <IconCursorClick size={BROWSER_ICON.tool} />
      </Button>
    </Tooltip>
  )
})
