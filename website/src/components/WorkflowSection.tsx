import React, { useState } from 'react'
import {
  WorktreeIcon,
  ZapIcon,
  CodeIcon,
  GithubIcon,
} from './icons/FeatureIcons'
import {
  MissionControlPreview,
  IntegratedDevPreview,
  PrLifecyclePreview,
} from './WorkflowPreviews'

const steps = [
  {
    icon: <WorktreeIcon />,
    title: '1. Spawn a Worktree',
    description:
      'Start a new feature or experiment. Braid automatically creates a Git worktree, keeping your main branch clean.',
  },
  {
    icon: <ZapIcon />,
    title: '2. Parallel Chat',
    description:
      'Each worktree gets its own Claude session. Claude knows exactly which files are in scope for that specific branch.',
  },
  {
    icon: <CodeIcon />,
    title: '3. Seamless Integration',
    description:
      'Edit files, run tests in the integrated terminal, and monitor CI - all without leaving the app.',
  },
  {
    icon: <GithubIcon />,
    title: '4. PR & CI Lifecycle',
    description:
      'Stage, commit, and push without leaving the app. Monitor CI checks in real time, fix failures with AI, and merge with one click.',
  },
]

/* ── Tiny inline SVG icons matching the real app ── */

function BranchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ChevronIcon({ open = false }: { open?: boolean }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="bp-spinner">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

function PrIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 9v12" />
      <path d="M18 9a9 9 0 0 0-9 9" />
    </svg>
  )
}

function TerminalPromptIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function WorkflowStepCard({
  icon,
  title,
  description,
  active = false,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className={`workflow-step ${active ? 'workflow-step--active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.() }}
    >
      <div className={`workflow-step__icon ${active ? 'workflow-step__icon--active' : ''}`}>
        {icon}
      </div>
      <h3 className="workflow-step__title">{title}</h3>
      <p className="workflow-step__desc">{description}</p>
    </div>
  )
}

/* ── Shared Activity Bar ── */
function ActivityBar({ activeIndex = 0 }: { activeIndex?: number }) {
  return (
    <div className="bp-activity">
      <div className="bp-activity__drag" />
      <div className="bp-activity__icons">
        <div className={`bp-activity__item ${activeIndex === 0 ? 'bp-activity__item--active' : ''}`}>
          <BranchIcon size={16} />
        </div>
        <div className={`bp-activity__item ${activeIndex === 1 ? 'bp-activity__item--active' : ''}`}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
      </div>
      <div className="bp-activity__bottom">
        <div className="bp-activity__item">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
      </div>
    </div>
  )
}

/* ── Shared Sidebar ── */
function Sidebar() {
  return (
    <div className="bp-sidebar">
      <div className="bp-sidebar__drag" />
      <div className="bp-sidebar__header">
        <span className="bp-sidebar__title">PROJECTS</span>
      </div>
      <div className="bp-sidebar__content">
        <div className="bp-project">
          <div className="bp-project__header">
            <ChevronIcon open />
            <span className="bp-project__name">braid</span>
            <span className="bp-project__count">4</span>
          </div>
          <div className="bp-wt bp-wt--selected">
            <span className="bp-wt__dot bp-wt__dot--running" />
            <span className="bp-wt__name">feature/auth-v2</span>
            <span className="bp-wt__pr"><PrIcon /></span>
          </div>
          <div className="bp-wt">
            <span className="bp-wt__dot bp-wt__dot--idle" />
            <span className="bp-wt__name">main</span>
          </div>
          <div className="bp-wt">
            <span className="bp-wt__dot bp-wt__dot--waiting" />
            <span className="bp-wt__name">bugfix/api-latency</span>
          </div>
          <div className="bp-wt">
            <span className="bp-wt__dot bp-wt__dot--inactive" />
            <span className="bp-wt__name">exp/canvas-engine</span>
          </div>
        </div>
        <div className="bp-project" style={{ marginTop: 8 }}>
          <div className="bp-project__header">
            <ChevronIcon />
            <span className="bp-project__name">mercari-app</span>
            <span className="bp-project__count">2</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Preview 1: Worktree Spawning (Chat view) */
function AppPreview() {
  return (
    <div className="bp">
      <ActivityBar activeIndex={0} />
      <Sidebar />

      {/* ── Resize handle ── */}
      <div className="bp-resize" />

      {/* ── Center Panel ── */}
      <div className="bp-center">
        <div className="bp-center__drag" />

        {/* Session tab bar */}
        <div className="bp-tab-bar">
          <div className="bp-tab bp-tab--active">
            <span className="bp-tab__text">auth refactor</span>
            <span className="bp-tab__badge">3</span>
          </div>
          <div className="bp-tab bp-tab--running">
            <span className="bp-tab__text">test coverage</span>
          </div>
          <div className="bp-tab">
            <span className="bp-tab__text">+</span>
          </div>
        </div>

        {/* Chat messages */}
        <div className="bp-chat">
          {/* User message */}
          <div className="bp-msg bp-msg--user">
            <div className="bp-msg__bubble bp-msg__bubble--user">
              Implement a new hook for session persistence in <code>hooks.ts</code>. It should handle the worktree-specific cache.
            </div>
          </div>

          {/* Snippet chips (file attachments) */}
          <div className="bp-snippets">
            <span className="bp-snippet"><FileIcon /> src/auth/hooks.ts</span>
            <span className="bp-snippet"><FileIcon /> src/auth/types.ts</span>
          </div>

          {/* Assistant message */}
          <div className="bp-msg bp-msg--assistant">
            <div className="bp-msg__content">
              I'll analyze the worktree structure for <code>feature/auth-v2</code> and implement <code>useWorktreeSession</code>. Let me read the existing hooks first.
            </div>
          </div>

          {/* Tool call group - expanded with body */}
          <div className="bp-tcg">
            <div className="bp-tcg__header">
              <ChevronIcon open />
              <CheckIcon />
              <span className="bp-tcg__label">Read src/auth/hooks.ts</span>
            </div>
            <div className="bp-tcg__body">
              <div className="bp-tcg__row">
                <span className="bp-tcg__row-icon"><CheckIcon /></span>
                <span className="bp-tcg__row-name">Read</span>
                <span className="bp-tcg__row-path">src/auth/hooks.ts</span>
              </div>
              <div className="bp-tcg__row">
                <span className="bp-tcg__row-icon"><CheckIcon /></span>
                <span className="bp-tcg__row-name">Read</span>
                <span className="bp-tcg__row-path">src/auth/types.ts</span>
              </div>
            </div>
          </div>

          {/* Tool call group - in progress */}
          <div className="bp-tcg">
            <div className="bp-tcg__header">
              <ChevronIcon open />
              <SpinnerIcon />
              <span className="bp-tcg__label">Edit src/auth/hooks.ts</span>
            </div>
            <div className="bp-tcg__body">
              <div className="bp-tcg__row">
                <span className="bp-tcg__row-icon bp-tcg__row-icon--running"><SpinnerIcon /></span>
                <span className="bp-tcg__row-name">Edit</span>
                <span className="bp-tcg__row-path">src/auth/hooks.ts +28 -3</span>
              </div>
            </div>
          </div>

          {/* Assistant follow-up with code */}
          <div className="bp-msg bp-msg--assistant">
            <div className="bp-msg__content">
              I've added the <code>useWorktreeSession</code> hook with cache invalidation:
            </div>
            <pre className="bp-msg__pre"><code><span className="bp-hl-kw">export const</span> <span className="bp-hl-fn">useWorktreeSession</span> = () =&gt; {'{\n'}<span className="bp-hl-kw">  const</span> {'{ worktreeId }'} = <span className="bp-hl-fn">useParams</span>();{'\n'}<span className="bp-hl-kw">  const</span> queryClient = <span className="bp-hl-fn">useQueryClient</span>();{'\n\n'}<span className="bp-hl-kw">  return</span> <span className="bp-hl-fn">useQuery</span>({'\n'}    [<span className="bp-hl-str">'session'</span>, worktreeId],{'\n'}    () =&gt; <span className="bp-hl-fn">fetchSession</span>(worktreeId),{'\n'}    {'{ '}<span className="bp-hl-attr">staleTime</span>: <span className="bp-hl-num">30_000</span> {'}'}
{'\n'}  );{'\n'}{'};'}</code></pre>
          </div>

          {/* Tool call group - bash */}
          <div className="bp-tcg">
            <div className="bp-tcg__header">
              <ChevronIcon />
              <CheckIcon />
              <span className="bp-tcg__label">Ran yarn test auth</span>
            </div>
          </div>

          <div className="bp-msg bp-msg--assistant">
            <div className="bp-msg__content">
              All 12 tests passing. The hook is ready for review.
            </div>
          </div>
        </div>

        {/* Chat input */}
        <div className="bp-input">
          <div className="bp-input__box">
            <span className="bp-input__placeholder">Message Claude...</span>
            <span className="bp-input__send">&#x2191;</span>
          </div>
          <div className="bp-input__footer">
            <span className="bp-input__chip bp-input__chip--active">
              <BranchIcon size={11} />
              feature/auth-v2
            </span>
            <span className="bp-input__chip">sonnet</span>
          </div>
        </div>
      </div>

      {/* ── Resize handle ── */}
      <div className="bp-resize" />

      {/* ── Right Panel ── */}
      <div className="bp-right">
        <div className="bp-right__drag" />
        <div className="bp-tab-bar bp-tab-bar--right">
          <div className="bp-tab bp-tab--active">Files</div>
          <div className="bp-tab">Changes <span className="bp-tab__badge bp-tab__badge--sm">2</span></div>
          <div className="bp-tab">Checks</div>
        </div>
        <div className="bp-right__content">
          <div className="bp-file-tree">
            <div className="bp-ft__row">
              <ChevronIcon open />
              <FolderIcon />
              <span>src</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent">
              <ChevronIcon open />
              <FolderIcon />
              <span>auth</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent2 bp-ft__row--active">
              <FileIcon />
              <span>hooks.ts</span>
              <span className="bp-ft__badge">M</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent2">
              <FileIcon />
              <span>provider.ts</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent2">
              <FileIcon />
              <span>types.ts</span>
              <span className="bp-ft__badge">M</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent2">
              <FileIcon />
              <span>context.tsx</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent">
              <ChevronIcon open />
              <FolderIcon />
              <span>components</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent2">
              <FileIcon />
              <span>LoginForm.tsx</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent2">
              <FileIcon />
              <span>AuthGuard.tsx</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent">
              <ChevronIcon />
              <FolderIcon />
              <span>store</span>
            </div>
            <div className="bp-ft__row bp-ft__row--indent">
              <ChevronIcon />
              <FolderIcon />
              <span>lib</span>
            </div>
            <div className="bp-ft__row">
              <ChevronIcon />
              <FolderIcon />
              <span>__tests__</span>
            </div>
          </div>
        </div>

        {/* Terminal at bottom of right panel */}
        <div className="bp-terminal">
          <div className="bp-terminal__header">
            <span className="bp-terminal__tab bp-terminal__tab--active">
              <TerminalPromptIcon />
              zsh
            </span>
          </div>
          <div className="bp-terminal__body">
            <div className="bp-terminal__line">
              <span className="bp-terminal__prompt">$</span>
              <span>yarn test auth</span>
            </div>
            <div className="bp-terminal__line bp-terminal__line--dim">
              PASS src/auth/__tests__/hooks.test.ts
            </div>
            <div className="bp-terminal__line bp-terminal__line--green">
              Tests: 12 passed, 12 total
            </div>
            <div className="bp-terminal__line bp-terminal__line--green">
              Time:  1.34s
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Wraps previews 3 & 4 that share the sidebar + activity bar shell */
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bp">
      <ActivityBar activeIndex={0} />
      <Sidebar />
      <div className="bp-resize" />
      {children}
    </div>
  )
}

/** Preview 2 (Mission Control) uses a different shell - full-width kanban */
function MissionControlShell() {
  return (
    <div className="bp">
      <ActivityBar activeIndex={1} />
      <div className="bp-mc-main">
        <div className="bp-center__drag" />
        <MissionControlPreview />
      </div>
    </div>
  )
}

const previews = [
  // 0: Worktree Spawning (existing AppPreview inline)
  null,
  // 1: Mission Control
  'mc',
  // 2: Integrated Dev
  'dev',
  // 3: PR Lifecycle
  'pr',
] as const

export default function WorkflowSection(): React.JSX.Element {
  const [activeIdx, setActiveIdx] = useState(0)

  function renderPreview() {
    switch (activeIdx) {
      case 1:
        return <MissionControlShell />
      case 2:
        return <AppShell><IntegratedDevPreview /></AppShell>
      case 3:
        return <AppShell><PrLifecyclePreview /></AppShell>
      default:
        return <AppPreview />
    }
  }

  return (
    <section className="workflow-section">
      <div className="workflow-section__header">
        <h2 className="workflow-section__title">
          Context is King. <br />
          <span className="workflow-section__title-accent">Isolation is Queen.</span>
        </h2>
        <p className="workflow-section__subtitle">
          By isolating AI sessions within Git worktrees, Braid eliminates context
          bleeding and maximizes parallel productivity.
        </p>
      </div>

      <div className="workflow-layout">
        <div className="workflow-steps">
          {steps.map((step, i) => (
            <WorkflowStepCard
              key={step.title}
              {...step}
              active={i === activeIdx}
              onClick={() => setActiveIdx(i)}
            />
          ))}
        </div>
        <div className="workflow-preview-col">
          <div className="bp-preview-fade" key={activeIdx}>
            {renderPreview()}
          </div>
        </div>
      </div>
    </section>
  )
}
