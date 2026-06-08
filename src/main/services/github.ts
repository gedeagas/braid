export { fetchIfStale, resolveNwo } from './github/core'
export { GitHubService } from './github/operations'
export * from './github/types'

import { GitHubService } from './github/operations'

export const githubService = new GitHubService()
