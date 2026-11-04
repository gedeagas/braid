// Title-based agent status detection. Shared with the PTY daemon, which runs
// it against its headless terminal; see @shared/agent-detection/title.
export { detectAgentStatusFromTitle, registerTitleDetection } from '@shared/agent-detection/title'
export type { TitleDetectionResult, TitleDetectionOptions } from '@shared/agent-detection/title'
