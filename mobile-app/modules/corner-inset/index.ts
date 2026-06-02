import { requireNativeView } from 'expo';
import { Platform, type ViewProps } from 'react-native';
import type { ComponentType } from 'react';

/**
 * Native module: iPadOS 26 "Corner Adaptation Margin" (window controls) inset.
 *
 * The native view is an invisible measuring surface that reports the corner
 * margin of its window so custom headers can offset their leading content past
 * the window controls ("traffic lights"). See `CornerInsetModule.swift`.
 *
 * Only the Apple platform is wired (`expo-module.config.json`); on Android/web
 * `NativeCornerInsetView` is null and callers render nothing.
 */
export type CornerInsets = {
  /** Inset from the leading (left in LTR) edge - where the controls sit. */
  leading: number;
  /** Inset from the trailing edge (controls can mirror in RTL). */
  trailing: number;
  /** Inset from the top edge. */
  top: number;
};

export type CornerInsetsChangeEvent = { nativeEvent: CornerInsets };

type NativeProps = ViewProps & {
  onInsetsChange?: (event: CornerInsetsChangeEvent) => void;
};

// `requireNativeView` throws if the native view isn't registered, so guard to
// iOS where the module ships, and to a try/catch so a missing registration (an
// old dev-client built before this module landed) degrades to "render nothing"
// instead of crashing the screen at import.
function resolveNativeView(): ComponentType<NativeProps> | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return requireNativeView<NativeProps>('CornerInset');
  } catch {
    return null;
  }
}

export const NativeCornerInsetView: ComponentType<NativeProps> | null = resolveNativeView();
