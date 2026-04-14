export type { ThemeGroup, ThemePalette } from './types'

import { ThemeGroup, ThemePalette } from './types'
import { defaultThemes } from './default'
import { darkThemes } from './dark'
import { lightThemes } from './light'
import { accessibilityThemes } from './accessibility'

export const builtinThemes: ThemePalette[] = [
  ...defaultThemes,
  ...darkThemes,
  ...lightThemes,
  ...accessibilityThemes
]

export function findTheme(
  id: string,
  customThemes: ThemePalette[]
): ThemePalette | undefined {
  return builtinThemes.find((t) => t.id === id) ?? customThemes.find((t) => t.id === id)
}

const GROUP_ORDER: ThemeGroup[] = ['default', 'dark', 'light', 'accessibility']

export function groupBuiltinThemes(): { group: ThemeGroup; themes: ThemePalette[] }[] {
  return GROUP_ORDER.map((g) => ({ group: g, themes: builtinThemes.filter((t) => t.group === g) }))
    .filter((g) => g.themes.length > 0)
}
