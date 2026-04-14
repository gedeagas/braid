import { useReducer, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconExternalLink, IconChevronDownSmall, IconCheckFill } from './icons'
import { loadStr } from '@/store/ui/helpers'
import { SK } from '@/lib/storageKeys'
import * as ipc from '@/lib/ipc'

interface InstalledApp {
  id: string
  name: string
  icon: string | null
}

// Module-level cache - installed apps don't change during a session
let cachedApps: InstalledApp[] | null = null

interface Props {
  path: string
  label?: string
}

interface State {
  open: boolean
  apps: InstalledApp[]
}

type Action =
  | { type: 'toggle' }
  | { type: 'close' }
  | { type: 'setApps'; apps: InstalledApp[] }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'toggle':
      return { ...state, open: !state.open }
    case 'close':
      return { ...state, open: false }
    case 'setApps':
      return { ...state, apps: action.apps }
  }
}

export function OpenInDropdown({ path, label }: Props) {
  const { t } = useTranslation('settings')
  const [state, dispatch] = useReducer(reducer, {
    open: false,
    apps: cachedApps ?? [],
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const splitRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Eagerly fetch apps on mount (for label icon), or lazily on first dropdown open
  useEffect(() => {
    if (cachedApps) {
      if (state.apps.length === 0) dispatch({ type: 'setApps', apps: cachedApps })
      return
    }
    // In labeled mode, fetch immediately so the label icon is available;
    // in icon-only mode, wait until the dropdown opens
    if (!label && !state.open) return
    ipc.shell.getInstalledApps().then((result: InstalledApp[]) => {
      cachedApps = result
      dispatch({ type: 'setApps', apps: result })
    })
  }, [state.open, label]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on click-outside or Escape
  useEffect(() => {
    if (!state.open) return
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) {
        // In split mode, check the split container; in icon mode, check the trigger
        const anchor = splitRef.current ?? triggerRef.current
        if (anchor && !anchor.contains(target)) {
          dispatch({ type: 'close' })
        }
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'close' })
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [state.open])

  // Position menu below trigger, clamp to viewport
  useLayoutEffect(() => {
    if (!state.open || !menuRef.current) return
    const anchor = splitRef.current ?? triggerRef.current
    if (!anchor) return
    const anchorRect = anchor.getBoundingClientRect()
    let top = anchorRect.bottom + 4
    let left = anchorRect.left

    menuRef.current.style.top = `${top}px`
    menuRef.current.style.left = `${left}px`

    const menuRect = menuRef.current.getBoundingClientRect()
    if (menuRect.right > window.innerWidth) {
      left = window.innerWidth - menuRect.width - 8
    }
    if (menuRect.bottom > window.innerHeight) {
      top = anchorRect.top - menuRect.height - 4
    }

    menuRef.current.style.top = `${top}px`
    menuRef.current.style.left = `${left}px`
  }, [state.open])

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(path)
    dispatch({ type: 'close' })
  }, [path])

  // Open in selected app and persist the choice
  const handleOpenIn = useCallback((appId: string) => {
    ipc.shell.openInApp(appId, path)
    try { localStorage.setItem(SK.lastOpenInApp, appId) } catch { /* quota */ }
    dispatch({ type: 'close' })
  }, [path])

  // Label click - open in last-used app directly
  const handleLabelClick = useCallback(() => {
    if (state.open) dispatch({ type: 'close' })
    const lastApp = loadStr(SK.lastOpenInApp, 'finder')
    ipc.shell.openInApp(lastApp, path)
  }, [path, state.open])

  const lastAppId = loadStr(SK.lastOpenInApp, '')
  const lastApp = state.apps.find((a) => a.id === lastAppId)
  const lastAppName = lastApp?.name
  const lastAppIcon = lastApp?.icon

  const menu = state.open && createPortal(
    <div ref={menuRef} className="context-menu" style={{ position: 'fixed' }}>
      <button className="context-menu-item" onClick={handleCopyPath}>
        {t('project.copyPath')}
        <span className="context-menu-item-shortcut">{'\u2318'}C</span>
      </button>
      <div className="context-menu-separator" />
      {state.apps.map((a) => (
        <button
          key={a.id}
          className="context-menu-item open-in-app-item"
          onClick={() => handleOpenIn(a.id)}
        >
          {a.icon ? (
            <img
              src={a.icon}
              alt=""
              className="open-in-app-icon"
              draggable={false}
            />
          ) : (
            <span className="open-in-app-icon-placeholder" />
          )}
          <span className="open-in-app-name">{a.name}</span>
          {a.id === lastAppId && (
            <IconCheckFill size={12} className="open-in-check" />
          )}
        </button>
      ))}
    </div>,
    document.body
  )

  // Split trigger mode (labeled - used in CenterPanel header)
  if (label) {
    const tooltip = lastAppName
      ? t('project.openInLastApp', { app: lastAppName })
      : t('project.openIn')

    return (
      <>
        <div ref={splitRef} className="open-in-split">
          <button
            className="open-in-split-label"
            onClick={handleLabelClick}
            title={tooltip}
          >
            {lastAppIcon && (
              <img
                src={lastAppIcon}
                alt=""
                className="open-in-split-icon"
                draggable={false}
              />
            )}
            <span className="open-in-split-slash">/</span>
            <span className="open-in-trigger-label">{label}</span>
          </button>
          <button
            ref={triggerRef}
            className="open-in-split-chevron"
            onClick={() => dispatch({ type: 'toggle' })}
            title={t('project.openIn')}
          >
            <IconChevronDownSmall size={9} />
          </button>
        </div>
        {menu}
      </>
    )
  }

  // Icon-only mode (used in SettingsProject)
  return (
    <>
      <button
        ref={triggerRef}
        className="open-in-trigger"
        onClick={() => dispatch({ type: 'toggle' })}
        title={t('project.openIn')}
      >
        <IconExternalLink size={13} />
      </button>
      {menu}
    </>
  )
}
