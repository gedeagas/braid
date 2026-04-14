import React from 'react'

/* ── Shared tiny inline SVG icons ── */

function StatusDot({ status }: { status: 'running' | 'waiting' | 'idle' | 'done' }) {
  const cls = `bp-wt__dot bp-wt__dot--${status === 'done' ? 'idle' : status}`
  return <span className={cls} />
}

function BranchIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
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

function TerminalPromptIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
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

function SpinnerIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="bp-spinner">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

/* ====================================================================
   Preview 2: Mission Control (Kanban Board)
   ==================================================================== */

function McCard({ branch, session, time, status, pr }: {
  branch: string; session: string; time: string;
  status: 'running' | 'waiting' | 'idle' | 'done';
  pr?: { num: number; checks: string; adds: string; dels: string }
}) {
  return (
    <div className={`bp-mc-card bp-mc-card--${status}`}>
      <div className="bp-mc-card__branch">
        <BranchIcon size={10} />
        {branch}
      </div>
      <div className="bp-mc-card__status">
        <StatusDot status={status} />
        <span className="bp-mc-card__session">{session}</span>
        <span className="bp-mc-card__time">{time}</span>
      </div>
      {pr && (
        <div className="bp-mc-card__pr">
          <span className="bp-mc-card__pr-num">PR #{pr.num}</span>
          <span>{pr.checks}</span>
          <span className="bp-mc-card__pr-adds">{pr.adds}</span>
          <span className="bp-mc-card__pr-dels">{pr.dels}</span>
        </div>
      )}
    </div>
  )
}

export function MissionControlPreview() {
  return (
    <div className="bp-mc-board">
      {/* Running column */}
      <div className="bp-mc-col">
        <div className="bp-mc-col__header bp-mc-col__header--blue">
          <span className="bp-mc-col__title">Running</span>
          <span className="bp-mc-col__count">2</span>
        </div>
        <div className="bp-mc-col__body">
          <McCard branch="feature/auth-v2" session="auth refactor" time="4m 12s" status="running"
            pr={{ num: 142, checks: '✅', adds: '+284', dels: '-31' }} />
          <McCard branch="bugfix/api-latency" session="fix timeout" time="1m 08s" status="running" />
        </div>
      </div>

      {/* Waiting column */}
      <div className="bp-mc-col">
        <div className="bp-mc-col__header bp-mc-col__header--amber">
          <span className="bp-mc-col__title">Waiting Input</span>
          <span className="bp-mc-col__count">1</span>
        </div>
        <div className="bp-mc-col__body">
          <McCard branch="feat/dark-mode" session="theme migration" time="12m 34s" status="waiting"
            pr={{ num: 138, checks: '⏳', adds: '+89', dels: '-12' }} />
        </div>
      </div>

      {/* Done column */}
      <div className="bp-mc-col">
        <div className="bp-mc-col__header bp-mc-col__header--green">
          <span className="bp-mc-col__title">Done</span>
          <span className="bp-mc-col__count">2</span>
        </div>
        <div className="bp-mc-col__body">
          <McCard branch="main" session="docs update" time="2m 01s" status="done"
            pr={{ num: 141, checks: '✅', adds: '+42', dels: '-8' }} />
          <McCard branch="fix/scroll-perf" session="scroll fix" time="5m 44s" status="done" />
        </div>
      </div>
    </div>
  )
}

/* ====================================================================
   Preview 3: Integrated Dev (Editor + Simulator + Terminal)
   ==================================================================== */

export function IntegratedDevPreview() {
  return (
    <>
      {/* Center: Editor */}
      <div className="bp-center">
        <div className="bp-center__drag" />
        <div className="bp-tab-bar">
          <div className="bp-tab bp-tab--active">
            <span className="bp-tab__text">hooks.ts</span>
          </div>
          <div className="bp-tab">
            <span className="bp-tab__text">types.ts</span>
          </div>
          <div className="bp-tab">
            <span className="bp-tab__text">index.ts</span>
          </div>
          <div className="bp-tab">
            <span className="bp-tab__text">+</span>
          </div>
        </div>

        {/* File toolbar */}
        <div className="bp-editor-toolbar">
          <span className="bp-editor-toolbar__path">src/auth/hooks.ts</span>
          <span className="bp-editor-toolbar__dirty">●</span>
        </div>

        {/* Monaco-style editor with minimap */}
        <div className="bp-editor-wrap">
          <div className="bp-editor">
            <EditorLine n={1} code={<><span className="bp-hl-kw">import</span> {'{ useQuery, useQueryClient }'} <span className="bp-hl-kw">from</span> <span className="bp-hl-str">'@tanstack/react-query'</span>;</>} />
            <EditorLine n={2} code={<><span className="bp-hl-kw">import</span> {'{ useParams }'} <span className="bp-hl-kw">from</span> <span className="bp-hl-str">'react-router-dom'</span>;</>} />
            <EditorLine n={3} code={<><span className="bp-hl-kw">import</span> {'{ fetchSession, Session }'} <span className="bp-hl-kw">from</span> <span className="bp-hl-str">'./api'</span>;</>} />
            <EditorLine n={4} code="" />
            <EditorLine n={5} code={<><span className="bp-hl-kw">interface</span> <span className="bp-hl-type">SessionOptions</span> {'{'}</>} />
            <EditorLine n={6} code={<>{'  '}<span className="bp-hl-attr">staleTime</span>?: <span className="bp-hl-type">number</span>;</>} />
            <EditorLine n={7} code={<>{'  '}<span className="bp-hl-attr">enabled</span>?: <span className="bp-hl-type">boolean</span>;</>} />
            <EditorLine n={8} code={<>{'}'}</>} />
            <EditorLine n={9} code="" />
            <EditorLine n={10} code={<><span className="bp-hl-kw">export const</span> <span className="bp-hl-fn">useWorktreeSession</span> = (<span className="bp-hl-attr">opts</span>?: <span className="bp-hl-type">SessionOptions</span>) =&gt; {'{'}</>} active />
            <EditorLine n={11} code={<>{'  '}<span className="bp-hl-kw">const</span> {'{ worktreeId }'} = <span className="bp-hl-fn">useParams</span>();</>} active />
            <EditorLine n={12} code={<>{'  '}<span className="bp-hl-kw">const</span> client = <span className="bp-hl-fn">useQueryClient</span>();</>} active />
            <EditorLine n={13} code="" active />
            <EditorLine n={14} code={<>{'  '}<span className="bp-hl-kw">return</span> <span className="bp-hl-fn">useQuery</span>&lt;<span className="bp-hl-type">Session</span>&gt;({'{'}</>} active />
            <EditorLine n={15} code={<>{'    '}<span className="bp-hl-attr">queryKey</span>: [<span className="bp-hl-str">'session'</span>, worktreeId],</>} active />
            <EditorLine n={16} code={<>{'    '}<span className="bp-hl-attr">queryFn</span>: () =&gt; <span className="bp-hl-fn">fetchSession</span>(worktreeId),</>} active />
            <EditorLine n={17} code={<>{'    '}<span className="bp-hl-attr">staleTime</span>: opts?.<span className="bp-hl-attr">staleTime</span> ?? <span className="bp-hl-num">30_000</span>,</>} active />
            <EditorLine n={18} code={<>{'    '}<span className="bp-hl-attr">enabled</span>: opts?.<span className="bp-hl-attr">enabled</span> !== <span className="bp-hl-kw">false</span>,</>} active />
            <EditorLine n={19} code={<>{'  }'});</>} active />
            <EditorLine n={20} code={<>{'};'}</>} />
            <EditorLine n={21} code="" />
            <EditorLine n={22} code={<><span className="bp-hl-kw">export const</span> <span className="bp-hl-fn">useInvalidateSession</span> = () =&gt; {'{'}</>} />
            <EditorLine n={23} code={<>{'  '}<span className="bp-hl-kw">const</span> client = <span className="bp-hl-fn">useQueryClient</span>();</>} />
            <EditorLine n={24} code={<>{'  '}<span className="bp-hl-kw">return</span> (id: <span className="bp-hl-type">string</span>) =&gt; client.<span className="bp-hl-fn">invalidateQueries</span>({'{'}</>} />
            <EditorLine n={25} code={<>{'    '}<span className="bp-hl-attr">queryKey</span>: [<span className="bp-hl-str">'session'</span>, id],</>} />
            <EditorLine n={26} code={<>{'  }'});</>} />
            <EditorLine n={27} code={<>{'};'}</>} />
          </div>

          {/* Minimap */}
          <div className="bp-minimap">
            <div className="bp-minimap__viewport" />
            <div className="bp-minimap__line" />
            <div className="bp-minimap__line bp-minimap__line--long" />
            <div className="bp-minimap__line" />
            <div className="bp-minimap__line bp-minimap__line--short" />
            <div className="bp-minimap__line bp-minimap__line--short" />
            <div className="bp-minimap__line" />
            <div className="bp-minimap__line bp-minimap__line--gap" />
            <div className="bp-minimap__line bp-minimap__line--hl" />
            <div className="bp-minimap__line bp-minimap__line--hl" />
            <div className="bp-minimap__line bp-minimap__line--hl" />
            <div className="bp-minimap__line bp-minimap__line--hl" />
            <div className="bp-minimap__line bp-minimap__line--hl" />
            <div className="bp-minimap__line bp-minimap__line--hl" />
            <div className="bp-minimap__line bp-minimap__line--hl" />
            <div className="bp-minimap__line" />
            <div className="bp-minimap__line bp-minimap__line--long" />
            <div className="bp-minimap__line" />
            <div className="bp-minimap__line bp-minimap__line--long" />
            <div className="bp-minimap__line" />
          </div>
        </div>
      </div>

      <div className="bp-resize" />

      {/* Right: Simulator + Terminal */}
      <div className="bp-right bp-right--wide">
        <div className="bp-right__drag" />
        <div className="bp-tab-bar bp-tab-bar--right">
          <div className="bp-tab">Files</div>
          <div className="bp-tab bp-tab--active">Simulator</div>
          <div className="bp-tab">Diagnostics</div>
        </div>

        {/* Simulator device */}
        <div className="bp-sim">
          <div className="bp-sim__device bp-sim__device--large">
            <div className="bp-sim__notch" />
            <div className="bp-sim__screen">
              <div className="bp-sim__status-bar">9:41</div>
              <div className="bp-sim__nav">My App</div>
              <div className="bp-sim__content">
                <div className="bp-sim__header-bar">
                  <span className="bp-sim__avatar" />
                  <div className="bp-sim__header-text">
                    <div className="bp-sim__header-title" />
                    <div className="bp-sim__header-sub" />
                  </div>
                </div>
                <div className="bp-sim__card" />
                <div className="bp-sim__card bp-sim__card--short" />
                <div className="bp-sim__list-item" />
                <div className="bp-sim__list-item" />
                <div className="bp-sim__list-item bp-sim__list-item--short" />
              </div>
              <div className="bp-sim__tab-bar">
                <span className="bp-sim__tab-dot bp-sim__tab-dot--active" />
                <span className="bp-sim__tab-dot" />
                <span className="bp-sim__tab-dot" />
                <span className="bp-sim__tab-dot" />
              </div>
            </div>
          </div>
          <div className="bp-sim__toolbar">
            <span className="bp-sim__badge">React Native</span>
            <span className="bp-sim__badge bp-sim__badge--dim">iPhone 16</span>
          </div>
        </div>

        {/* Terminal */}
        <div className="bp-terminal">
          <div className="bp-terminal__header">
            <span className="bp-terminal__tab bp-terminal__tab--active">
              <TerminalPromptIcon /> zsh
            </span>
          </div>
          <div className="bp-terminal__body">
            <div className="bp-terminal__line">
              <span className="bp-terminal__prompt">$</span> yarn test --watch
            </div>
            <div className="bp-terminal__line bp-terminal__line--dim">
              RUNS  src/auth/__tests__/hooks.test.ts
            </div>
            <div className="bp-terminal__line bp-terminal__line--green">
              PASS  hooks.test.ts (14 tests)
            </div>
            <div className="bp-terminal__line bp-terminal__line--dim">
              Snapshots: 0 total
            </div>
            <div className="bp-terminal__line bp-terminal__line--green">
              Tests:     14 passed, 14 total
            </div>
            <div className="bp-terminal__line bp-terminal__line--dim">
              Watching for changes...
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function EditorLine({ n, code, active }: { n: number; code: React.ReactNode; active?: boolean }) {
  return (
    <div className={`bp-editor__line ${active ? 'bp-editor__line--active' : ''}`}>
      <span className="bp-editor__gutter">{n}</span>
      <span className="bp-editor__code">{code}</span>
    </div>
  )
}

/* ====================================================================
   Preview 4: PR & CI Lifecycle (Changes + Checks + Merge Bar)
   Matches the real Braid app: center = Changes tab, right = Checks tab
   with merge bar floating at bottom of right panel.
   ==================================================================== */

function XCircleIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  )
}

function MergeIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

export function PrLifecyclePreview() {
  return (
    <>
      {/* Center: Chat session (Claude creating PR / fixing CI) */}
      <div className="bp-center">
        <div className="bp-center__drag" />
        <div className="bp-tab-bar">
          <div className="bp-tab bp-tab--active">
            <span className="bp-tab__text">auth refactor</span>
          </div>
          <div className="bp-tab">
            <span className="bp-tab__text">+</span>
          </div>
        </div>

        <div className="bp-chat">
          {/* User message */}
          <div className="bp-msg bp-msg--user">
            <div className="bp-msg__bubble bp-msg__bubble--user">
              Create a PR for the session persistence changes. Include a test plan.
            </div>
          </div>

          {/* Assistant tool calls */}
          <div className="bp-msg bp-msg--assistant">
            <div className="bp-tcg">
              <div className="bp-tcg__header">
                <CheckIcon /> <span className="bp-tcg__label">Committed 3 files</span>
              </div>
            </div>
            <div className="bp-tcg">
              <div className="bp-tcg__header">
                <CheckIcon /> <span className="bp-tcg__label">Pushed to origin/feature/auth-v2</span>
              </div>
            </div>
            <div className="bp-tcg">
              <div className="bp-tcg__header">
                <CheckIcon /> <span className="bp-tcg__label">Created PR #142</span>
              </div>
            </div>
          </div>

          {/* Assistant response */}
          <div className="bp-msg bp-msg--assistant">
            <div className="bp-msg__content">
              PR <code>#142</code> is up. The lint check is failing - looks like an unused import in <code>hooks.ts</code>. Let me fix that.
            </div>
          </div>

          {/* Fixing CI */}
          <div className="bp-msg bp-msg--assistant">
            <div className="bp-tcg">
              <div className="bp-tcg__header">
                <SpinnerIcon /> <span className="bp-tcg__label">Editing src/auth/hooks.ts</span>
              </div>
            </div>
          </div>
        </div>

        {/* Chat input */}
        <div className="bp-input">
          <div className="bp-input__box">
            <span className="bp-input__placeholder">Ask Claude...</span>
            <span className="bp-input__send">↑</span>
          </div>
        </div>
      </div>

      <div className="bp-resize" />

      {/* Right: Checks view with merge bar */}
      <div className="bp-right bp-right--wide">
        <div className="bp-right__drag" />
        <div className="bp-tab-bar bp-tab-bar--right">
          <div className="bp-tab">Files</div>
          <div className="bp-tab">Changes</div>
          <div className="bp-tab bp-tab--active">
            Checks
            <span className="bp-tab__badge bp-tab__badge--sm">4</span>
          </div>
        </div>

        {/* PR header */}
        <div className="bp-checks-pr">
          <div className="bp-checks-pr__top">
            <span className="bp-checks-pr__num">#142</span>
            <span className="bp-checks-pr__title">feat: session persistence</span>
          </div>
          <div className="bp-checks-pr__meta">
            <span className="bp-checks-pr__state">Open</span>
            <span className="bp-checks-pr__branch">
              <BranchIcon size={10} /> feature/auth-v2
            </span>
          </div>
        </div>

        {/* Git Status section */}
        <div className="bp-checks-body">
          <div className="bp-checks-section">
            <span className="bp-checks-section__title">Git Status</span>
          </div>
          <div className="bp-check-row">
            <span className="bp-status-dot bp-status-dot--pass" />
            <span className="bp-check-label">Ready for review</span>
          </div>
          <div className="bp-check-row">
            <span className="bp-status-dot bp-status-dot--pending" />
            <span className="bp-check-label">2 commits ahead</span>
            <span className="bp-checks-action-btn">Push</span>
          </div>

          {/* CI Checks section */}
          <div className="bp-checks-section" style={{ marginTop: 6 }}>
            <span className="bp-checks-section__title">Checks</span>
          </div>
          <div className="bp-check-row">
            <span className="bp-check-icon bp-check-icon--pass"><CheckIcon /></span>
            <span className="bp-check-label">Build</span>
            <span className="bp-check-meta">2m 14s</span>
          </div>
          <div className="bp-check-row">
            <span className="bp-check-icon bp-check-icon--pass"><CheckIcon /></span>
            <span className="bp-check-label">Unit Tests</span>
            <span className="bp-check-meta">1m 08s</span>
          </div>
          <div className="bp-check-row">
            <span className="bp-check-icon bp-check-icon--fail"><XCircleIcon /></span>
            <span className="bp-check-label">Lint</span>
            <span className="bp-checks-action-btn bp-checks-action-btn--danger">Fix with AI</span>
          </div>
          <div className="bp-check-row">
            <span className="bp-check-icon bp-check-icon--pass"><CheckIcon /></span>
            <span className="bp-check-label">Type Check</span>
            <span className="bp-check-meta">45s</span>
          </div>
        </div>

        {/* Merge bar - floating at bottom like the real app */}
        <div className="bp-merge-bar">
          <span className="bp-merge-bar__badge">
            <MergeIcon />
            #142
          </span>
          <span className="bp-merge-bar__status">
            <span className="bp-merge-bar__dot bp-merge-bar__dot--amber" />
            Checks failing
          </span>
          <span className="bp-merge-bar__block-pill">1 check failed</span>
          <span className="bp-merge-bar__btn bp-merge-bar__btn--disabled">
            <MergeIcon /> Merge <ChevronDownIcon />
          </span>
        </div>
      </div>
    </>
  )
}
