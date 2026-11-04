// OSC 9999 / OSC 9 agent status parsing. Shared with the PTY daemon, which
// runs it against its headless terminal; see @shared/agent-detection/osc.
export { registerAgentStatusOsc, registerBraidOsc9, formatAgentStatusOsc } from '@shared/agent-detection/osc'
export type { OscStatusPayload } from '@shared/agent-detection/osc'
