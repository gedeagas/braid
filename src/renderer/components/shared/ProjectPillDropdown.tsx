import { useState, useEffect } from 'react'
import type { Project } from '@/types'
import { IconCheckmark } from '@/components/shared/icons'

/**
 * Custom project picker rendered as an accent-colored pill button.
 * Opens a fully themed menu — no OS-native select chrome.
 *
 * Use in place of <select className="settings-claude-project-pill"> wherever
 * the user must pick a project from the list (Permissions, Instructions, Skills).
 */
interface ProjectPillDropdownProps {
  projects: Project[]
  value: string | null
  onChange: (id: string | null) => void
  placeholder: string
}

export function ProjectPillDropdown({
  projects,
  value,
  onChange,
  placeholder,
}: ProjectPillDropdownProps) {
  const [open, setOpen] = useState(false)

  const selected = projects.find((p) => p.id === value)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="settings-claude-project-pill"
        onClick={() => setOpen((v) => !v)}
      >
        {selected?.name ?? placeholder}
        <span className="project-pill-chevron">▾</span>
      </button>

      {open && (
        <>
          <div className="project-pill-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="project-pill-menu">
            {projects.map((p) => (
              <button
                key={p.id}
                className={`project-pill-menu-item${p.id === value ? ' project-pill-menu-item--active' : ''}`}
                onClick={() => { onChange(p.id); setOpen(false) }}
              >
                <span>{p.name}</span>
                {p.id === value && (
                  <IconCheckmark size={12} style={{ marginLeft: 'auto', flexShrink: 0 }} />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
