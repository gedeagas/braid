/**
 * Stroke-based SVG icons — 24×24 viewBox, inherits currentColor.
 * Default size 14×14 unless overridden.
 */
import { type IconProps, strokeIcon } from './types'

// ─── Tool icons (14×14) ─────────────────────────────────────────────────────

export const IconPencil = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
)
export const IconFile = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
)
export const IconTerminal = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
)
export const IconSearch = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
)
export const IconGlobe = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>
)
export const IconGitFork = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><circle cx="18" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="12" r="3"/><line x1="15.35" y1="7.35" x2="8.65" y2="10.65"/><line x1="15.35" y1="16.65" x2="8.65" y2="13.35"/></svg>
)
export const IconChecklist = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M4 7h3l2 2 4-4"/><line x1="16" y1="7" x2="21" y2="7"/><path d="M4 15h3l2 2 4-4"/><line x1="16" y1="15" x2="21" y2="15"/></svg>
)
export const IconInbox = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>
)
export const IconXCircle = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
)
export const IconBook = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
)
export const IconCodeBrackets = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
)
export const IconBolt = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
)
export const IconPlug = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8Z"/></svg>
)
export const IconSliders = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
)
export const IconMessageQuestion = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M12 8a1.5 1.5 0 0 0-1.14.5A1.5 1.5 0 0 0 10.5 10"/><line x1="12" y1="12" x2="12" y2="12.01"/></svg>
)
export const IconClipboardCheck = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>
)
export const IconWrench = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>
)
export const IconExternalLink = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
)

export const IconLink = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
)
export const IconPlus = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
)

// ─── Chevrons ────────────────────────────────────────────────────────────────

export const IconChevronRight = ({ size = 10, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)} strokeWidth={2.5}><polyline points="9 18 15 12 9 6"/></svg>
)
export const IconChevronDown = ({ size = 10, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)} strokeWidth={2.5}><polyline points="6 9 12 15 18 9"/></svg>
)

// ─── UI icons ────────────────────────────────────────────────────────────────

export const IconSparkle = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M12 3l1.9 5.5L20 12l-6.1 3.5L12 21l-1.9-5.5L4 12l6.1-3.5Z"/></svg>
)
export const IconLightbulb = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>
)
export const IconMessageBubble = ({ size = 48, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>
)
export const IconRefresh = ({ size = 14, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" style={{ display: 'block', ...p?.style }} className={p?.className}>
    <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 1 1 .908-.418A6 6 0 1 1 8 2v1Z" />
    <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466Z" />
  </svg>
)
export const IconGrid = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
)

// ─── Extracted from components ───────────────────────────────────────────────

export const IconArrowLeft = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M19 12H5M5 12L12 19M5 12L12 5"/></svg>
)
export const IconArrowDown = ({ size = 14, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p?.className} style={p?.style}>
    <path d="M7 2v10M3 8l4 4 4-4"/>
  </svg>
)
export const IconArrowUp = ({ size = 16, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={p?.className} style={p?.style}>
    <path d="M8 13V3M8 3L4 7M8 3L12 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
export const IconImage = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}>
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
)
export const IconClose = ({ size = 10, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" className={p?.className} style={p?.style}>
    <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
export const IconCheckmark = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)} strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>
)
export const IconCircle = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><circle cx="12" cy="12" r="9"/></svg>
)
export const IconPlay = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><polygon points="5 3 19 12 5 21 5 3"/></svg>
)
export const IconStop = ({ size = 12, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" className={p?.className} style={p?.style}>
    <rect width="10" height="10" rx="2"/>
  </svg>
)
export const IconSun = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}>
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
)
export const IconClock = ({ size = 16, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={p?.className} style={p?.style}>
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M8 4.5V8.5l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
export const IconSidebarLeft = ({ size = 20, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={p?.className} style={p?.style}>
    <rect x="1" y="2" width="14" height="12" rx="1.5" />
    <line x1="5.5" y1="2" x2="5.5" y2="14" />
  </svg>
)
export const IconSidebarRight = ({ size = 20, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={p?.className} style={p?.style}>
    <rect x="1" y="2" width="14" height="12" rx="1.5" />
    <line x1="10.5" y1="2" x2="10.5" y2="14" />
  </svg>
)
export const IconMessagePlus = ({ size = 48, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={p?.className} style={p?.style}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <line x1="12" y1="8" x2="12" y2="14" />
    <line x1="9" y1="11" x2="15" y2="11" />
  </svg>
)
export const IconSettings = ({ size = 16, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)
export const IconCopy = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

// ─── Notes toolbar icons ────────────────────────────────────────────────────

export const IconBold = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)} strokeWidth={2.5}><path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/></svg>
)
export const IconItalic = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)} strokeWidth={2.5}><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
)
export const IconStrikethrough = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M16 4H9a3 3 0 0 0 0 6"/><path d="M14 14a3 3 0 1 1-3 3H7"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
)
export const IconHeading = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)} strokeWidth={2.5}><path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/></svg>
)
export const IconListBullet = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
)
export const IconListOrdered = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
)
export const IconTaskList = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><rect x="3" y="5" width="4" height="4" rx="0.5"/><line x1="10" y1="7" x2="21" y2="7"/><rect x="3" y="15" width="4" height="4" rx="0.5"/><line x1="10" y1="17" x2="21" y2="17"/></svg>
)
export const IconBlockquote = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)} strokeWidth={2.5}><path d="M3 6v12"/><line x1="8" y1="8" x2="21" y2="8"/><line x1="8" y1="12" x2="18" y2="12"/><line x1="8" y1="16" x2="15" y2="16"/></svg>
)
export const IconCodeBlock = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m9 10-2 2 2 2"/><path d="m15 10 2 2-2 2"/></svg>
)
export const IconHorizontalRule = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><line x1="3" y1="12" x2="21" y2="12"/></svg>
)
export const IconUndo = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13"/></svg>
)
export const IconRedo = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.69 3L21 13"/></svg>
)
export const IconTrash = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
)
export const IconEye = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
)

// ─── Star icons ─────────────────────────────────────────────────────────────

export const IconStar = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
)
export const IconStarFilled = ({ size = 14, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" className={p.className} style={p.style}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
)

// ─── Right panel tab icons ──────────────────────────────────────────────────

export const IconDiff = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M14 7h4"/><path d="M16 5v4"/><path d="M8 15h6"/></svg>
)
export const IconSmartphone = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
)
export const IconMonitor = ({ size = 14, ...p }: IconProps) => (
  <svg {...strokeIcon(size, p)}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
)
