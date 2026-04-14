export type {
  LspServerStatus,
  LspInstallCandidate,
  LspServerConfig,
  LspDetectedServer,
  LspDiagnostic,
  LspHoverResult,
  LspLocation,
  LspRenameResult,
} from './types'

export { LspServerPool } from './pool'

import { LspServerPool } from './pool'
export const lspService = new LspServerPool()
