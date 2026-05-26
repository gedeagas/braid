/**
 * Agent icon components - brand SVGs for hero agents, Google favicon fallback,
 * and letter-in-rounded-rect for unknown agents.
 */
import { useId, useState } from 'react'
import { IconClaude, IconCodex } from './FillIcons'
import { getAgentEntry } from '@/lib/agentCatalog'

// ─── Inline brand SVGs (internal only) ──────────────────────────────────────

/** GitHub Copilot - Primer Octicons copilot-16 glyph */
const CopilotIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.173-1.82.822-2.558C3.012 1.454 4.051 1 5.328 1c.399 0 .725.006.969.014.243-.009.57-.014.968-.014 1.277 0 2.316.454 3.011 1.229.649.738.822 1.689.822 2.558 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.918c-.13.835-3.44 3.749-7.998 3.749h-.002Zm3.394-4.543c-.315 0-.727.201-1.231.605-.168.134-.378.301-.625.498-.429.343-.893.605-1.535.605h-.002c-.643 0-1.107-.262-1.534-.605a23.71 23.71 0 0 0-.626-.498c-.504-.404-.916-.605-1.231-.605-.075 0-.09.058-.061.2.038.186.129.481.36.852.169.272.401.576.721.86.556.495 1.392.862 2.37.862h.003c.978 0 1.813-.367 2.369-.861.32-.285.552-.589.722-.861.23-.371.32-.666.36-.852.028-.142.013-.2-.062-.2ZM6.266 2.5c-.86 0-1.586.327-2.049.869-.49.573-.615 1.347-.615 2.118 0 .485.075.909.213 1.263l.087.233-.18.163a.717.717 0 0 0-.126.2 2.026 2.026 0 0 0-.112.443c-.022.147-.04.298-.063.46l-.009.062a5.2 5.2 0 0 0-.072.49l-.007.094.084.04c.407.196.724.492.96.762.293.334.532.711.705 1.12.172.406.262.852.106 1.237-.076.189-.217.38-.457.493A12.1 12.1 0 0 0 8 11.173c1.09 0 2.06-.165 2.869-.403-.24-.113-.382-.304-.458-.493-.156-.385-.066-.831.106-1.238a4.37 4.37 0 0 1 .705-1.12 3.81 3.81 0 0 1 .96-.76l.083-.04-.007-.095a5.14 5.14 0 0 0-.072-.49l-.01-.06c-.022-.163-.04-.314-.062-.461a2.03 2.03 0 0 0-.112-.444.717.717 0 0 0-.126-.199l-.18-.163.087-.233c.138-.354.213-.778.213-1.263 0-.771-.125-1.545-.615-2.118-.463-.542-1.189-.869-2.049-.869H7.265c-.219.005-.38.014-.498.014-.118 0-.28-.009-.5-.014Z" />
  </svg>
)

/** Pi - pi.ai brand mark */
const PiIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor">
    <path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2Zm5.6 21.6h-2.8V11.2h-5.6v12.4H10.4V11.2H8V8.4h16v2.8h-2.4v12.4Z" />
  </svg>
)

/** OMP - brand mark with oklch gradient */
const OmpIcon = ({ size }: { size: number }) => {
  const id = useId()
  const gradId = `omp-grad-${id}`
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="6" fill={`url(#${gradId})`} />
      <text x="16" y="22" textAnchor="middle" fontSize="16" fontWeight="700" fill="white" fontFamily="system-ui, sans-serif">
        {'>'}_
      </text>
    </svg>
  )
}

/** Aider - brand mark (from safari-pinned-tab.svg) */
const AiderIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor">
    <path d="M16 3L4 28h5l7-16 7 16h5L16 3Zm0 11l4 9h-8l4-9Z" />
  </svg>
)

/** Kilocode - yellow-on-black brand mark */
const KiloIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <rect width="32" height="32" rx="6" fill="#1a1a1a" />
    <text x="16" y="22" textAnchor="middle" fontSize="18" fontWeight="800" fill="#facc15" fontFamily="system-ui, sans-serif">
      K
    </text>
  </svg>
)

/** Droid - white glyph on black rounded-rect */
const DroidIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <rect width="32" height="32" rx="6" fill="#1a1a1a" />
    <path
      d="M12.5 10l-2 -3M19.5 10l2 -3M10 17h12v5a4 4 0 01-4 4h-4a4 4 0 01-4-4v-5ZM10 14a6 6 0 0112 0v3H10v-3ZM13 15.5a1 1 0 100-2 1 1 0 000 2ZM19 15.5a1 1 0 100-2 1 1 0 000 2Z"
      fill="none"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// ─── Agent icon map for inline SVG heroes ────────────────────────────────────

const BRAND_ICON_MAP: Record<string, (props: { size: number }) => React.JSX.Element> = {
  claude: ({ size }) => <IconClaude size={size} />,
  codex: ({ size }) => <IconCodex size={size} />,
  copilot: CopilotIcon,
  pi: PiIcon,
  omp: OmpIcon,
  aider: AiderIcon,
  kilo: KiloIcon,
  droid: DroidIcon,
}

// ─── Google favicon component ────────────────────────────────────────────────

function AgentFaviconIcon({ domain, size, fallbackLetter }: { domain: string; size: number; fallbackLetter: string }) {
  const [hasError, setHasError] = useState(false)
  const fetchSize = size >= 28 ? 64 : 32
  const src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${fetchSize}`

  if (hasError) {
    return <AgentLetterIcon letter={fallbackLetter} size={size} />
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: 3, display: 'block' }}
      loading="lazy"
      crossOrigin="anonymous"
      onError={() => setHasError(true)}
    />
  )
}

// ─── Letter-in-rounded-rect fallback ─────────────────────────────────────────

function AgentLetterIcon({ letter, size }: { letter: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="9" fontWeight="600" fill="currentColor">
        {letter}
      </text>
    </svg>
  )
}

// ─── Main dispatch component ─────────────────────────────────────────────────

/** Agent icon component - dispatches to brand SVG, Google favicon, or letter fallback. */
export function AgentIcon({ agentId, size = 14 }: { agentId?: string; size?: number }) {
  if (!agentId) {
    return <AgentLetterIcon letter="?" size={size} />
  }

  // Tier 1: inline brand SVG
  const BrandIcon = BRAND_ICON_MAP[agentId]
  if (BrandIcon) return <BrandIcon size={size} />

  // Tier 2: Google favicon via catalog domain
  const entry = getAgentEntry(agentId)
  const letter = (agentId.charAt(0) || '?').toUpperCase()
  if (entry?.faviconDomain) {
    return <AgentFaviconIcon domain={entry.faviconDomain} size={size} fallbackLetter={letter} />
  }

  // Tier 3: letter-in-rounded-rect fallback
  return <AgentLetterIcon letter={letter} size={size} />
}
