import { create } from 'zustand'
import type { UIState } from './types'
import { createThemeSlice } from './theme'
import { createLayoutSlice } from './layout'
import { createTerminalSlice } from './terminal'
import { createSettingsSlice } from './settings'
import { createAppsSlice } from './apps'

export const useUIStore = create<UIState>((...a) => ({
  ...createThemeSlice(...a),
  ...createLayoutSlice(...a),
  ...createTerminalSlice(...a),
  ...createSettingsSlice(...a),
  ...createAppsSlice(...a),
}))
