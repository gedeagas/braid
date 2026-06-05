import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { Project } from '@/types'
import { IconCheckmark, IconChevronDownSmall, IconSearch } from '@/components/shared/icons'
import type { RepoPickerProps } from './types'
import { getProjectRepoAliases, getRepoMarkerColor, isSshRemote } from './taskUtils'

function RepoMarker({ project }: { project: Project }) {
  return (
    <span className="task-repo-marker" style={{ backgroundColor: getRepoMarkerColor(project) }} aria-hidden="true">
      {project.avatarUrl && <img src={project.avatarUrl} alt="" />}
    </span>
  )
}

function renderRepoPickerLabel(projects: Project[], selectedIds: ReadonlySet<string>, t: TFunction<'tasks'>): ReactNode {
  if (projects.length === 0) return <span className="task-repo-picker-muted">{t('repoPicker.noProjects')}</span>
  if (selectedIds.size === projects.length) return <span>{t('repoPicker.allProjects')}</span>
  const selectedProjects = projects.filter((project) => selectedIds.has(project.id))
  if (selectedProjects.length === 0) return <span className="task-repo-picker-muted">{t('repoPicker.noMatchingProjects')}</span>
  const [first, second, ...rest] = selectedProjects
  return (
    <span className="task-repo-picker-label">
      {first && (
        <span className="task-repo-picker-label-main">
          <RepoMarker project={first} />
          <span>{first.name}</span>
        </span>
      )}
      {second && <span className="task-repo-picker-label-extra">, {second.name}</span>}
      {rest.length > 0 && <span className="task-repo-picker-label-extra">+{rest.length}</span>}
    </span>
  )
}

function searchProjects(projects: Project[], query: string): Project[] {
  const term = query.trim().toLowerCase()
  if (!term) return projects
  return projects.filter((project) => getProjectRepoAliases(project).some((alias) => alias.includes(term)))
}

export function RepoMultiPicker({ projects, selectedIds, onChange, onSelectAll }: RepoPickerProps) {
  const { t } = useTranslation('tasks')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const allSelected = projects.length > 0 && selectedIds.size === projects.length
  const filteredProjects = useMemo(() => searchProjects(projects, search), [projects, search])

  const close = useCallback(() => {
    setOpen(false)
    setSearch('')
  }, [])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [close, open])

  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus())
  }, [open])

  const toggleProject = useCallback((projectId: string) => {
    const next = new Set(selectedIds)
    if (next.has(projectId)) {
      if (next.size <= 1) return
      next.delete(projectId)
    } else {
      next.add(projectId)
    }
    onChange(next)
  }, [onChange, selectedIds])

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      const first = projects[0]
      if (first) onChange(new Set([first.id]))
      return
    }
    onSelectAll()
  }, [allSelected, onChange, onSelectAll, projects])

  return (
    <div className="task-repo-picker" ref={pickerRef}>
      <button
        type="button"
        className="task-repo-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        disabled={projects.length === 0}
        role="combobox"
        aria-expanded={open}
        aria-label={t('repoPicker.filterByProject')}
      >
        <span className="task-repo-picker-trigger-label">{renderRepoPickerLabel(projects, selectedIds, t)}</span>
        <IconChevronDownSmall size={10} />
      </button>

      {open && (
        <div className="task-repo-picker-popover">
          <div className="task-repo-picker-search">
            <IconSearch size={12} />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') close()
              }}
              placeholder={t('repoPicker.searchPlaceholder')}
            />
          </div>
          <button className="task-repo-picker-all" onClick={handleSelectAll}>
            <span className="task-repo-picker-check">{allSelected && <IconCheckmark size={12} />}</span>
            <span>{t('repoPicker.allProjects')}</span>
          </button>
          <div className="task-repo-picker-list">
            {filteredProjects.length === 0 ? (
              <div className="task-repo-picker-empty">{t('repoPicker.emptySearch')}</div>
            ) : filteredProjects.map((project) => {
              const selected = selectedIds.has(project.id)
              const lastSelected = selected && selectedIds.size <= 1
              return (
                <button key={project.id} className="task-repo-picker-row" onClick={() => toggleProject(project.id)} disabled={lastSelected}>
                  <span className="task-repo-picker-check">{selected && <IconCheckmark size={12} />}</span>
                  <RepoMarker project={project} />
                  <span className="task-repo-picker-row-text">
                    <span className="task-repo-picker-row-title">
                      <span>{project.name}</span>
                      {isSshRemote(project) && <em>SSH</em>}
                    </span>
                    <span className="task-repo-picker-row-path">{project.path}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
