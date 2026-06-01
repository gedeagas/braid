/**
 * Single source of truth for the app's color palettes. Both schemes expose the
 * exact same keys so any themed style can switch between them with no branching.
 *
 * Keys:
 * - bg            screen background (behind everything)
 * - panel         card / header / bar surface
 * - panelStrong   raised control surface (inputs, chips, toggles)
 * - border        hairline separators and outlines
 * - text          primary foreground
 * - muted         secondary foreground
 * - subtle        tertiary foreground / labels
 * - accent        primary action / focus / selection
 * - accentSoft    low-emphasis accent fill
 * - success/danger/warning  status colors
 */
export interface Palette {
  bg: string;
  panel: string;
  panelStrong: string;
  border: string;
  text: string;
  muted: string;
  subtle: string;
  accent: string;
  accentSoft: string;
  success: string;
  danger: string;
  warning: string;
}

export const darkPalette: Palette = {
  bg: '#090A0B',
  panel: '#121417',
  panelStrong: '#191D22',
  border: '#2B3138',
  text: '#F7F8FA',
  muted: '#939BA7',
  subtle: '#626B78',
  accent: '#3D8BFF',
  accentSoft: '#17345F',
  success: '#35C98B',
  danger: '#FF5A66',
  warning: '#E5B84B',
};

export const lightPalette: Palette = {
  bg: '#FFFFFF',
  panel: '#F5F6F8',
  panelStrong: '#E9EBEF',
  border: '#D8DCE2',
  text: '#0B0D10',
  muted: '#5B636E',
  subtle: '#878F9A',
  accent: '#2C7BE5',
  accentSoft: '#D6E6FB',
  success: '#1F9D6B',
  danger: '#E0414E',
  warning: '#B7841C',
};

export type ColorScheme = 'light' | 'dark';

export const palettes: Record<ColorScheme, Palette> = {
  light: lightPalette,
  dark: darkPalette,
};
