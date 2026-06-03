import { useState } from 'react';
import { Platform, View } from 'react-native';

import {
  NativeCornerInsetView,
  type CornerInsets,
  type CornerInsetsChangeEvent,
} from '../../../modules/corner-inset';

const ZERO: CornerInsets = { leading: 0, trailing: 0, top: 0 };
const DEFAULT_HEADER_PADDING = 16;
const MAX_CORNER_SPACER = 64;

/**
 * Leading (or trailing) spacer that reserves room for the iPadOS 26 window
 * controls ("traffic lights"). Drop it as the first child of a custom header
 * row, before the back button:
 *
 *   <View style={{ flexDirection: 'row', alignItems: 'center' }}>
 *     <CornerInset />
 *     <Pressable onPress={() => router.back()}><ChevronLeft /></Pressable>
 *     ...
 *   </View>
 *
 * The window controls live in a `LayoutRegion` distinct from the safe area, so
 * the standard safe-area insets don't cover them - hence this dedicated native
 * measure. The underlying view is invisible and non-interactive; it reports the
 * window's corner margin and we size the spacer to match.
 *
 * Renders nothing on Android/web and on iPad/iPhone running pre-iPadOS-26 or in
 * full-screen (where the reported inset is 0), so it's a no-op everywhere the
 * controls aren't present.
 */
export function CornerInset({
  edge = 'leading',
  reservedPadding = DEFAULT_HEADER_PADDING,
  maxWidth = MAX_CORNER_SPACER,
}: {
  edge?: 'leading' | 'trailing';
  reservedPadding?: number;
  maxWidth?: number;
}) {
  const [insets, setInsets] = useState<CornerInsets>(ZERO);

  if (Platform.OS !== 'ios' || !Platform.isPad) return null;
  if (!NativeCornerInsetView) return null;

  const rawWidth = edge === 'leading' ? insets.leading : insets.trailing;
  const width = Math.max(0, Math.min(rawWidth, maxWidth) - reservedPadding);

  // The native view measures the WINDOW (not itself), so it stays mounted at
  // zero size and OUT of flex flow as a pure probe - otherwise, even at width 0,
  // it counts as a flex child and the parent row's `gap` inserts phantom spacing
  // before the back button. The in-flow spacer is only rendered when there's an
  // actual corner inset to reserve (iPadOS 26 window controls present).
  return (
    <>
      <NativeCornerInsetView
        pointerEvents="none"
        style={{ position: 'absolute', width: 0, height: 0 }}
        onInsetsChange={(event: CornerInsetsChangeEvent) => setInsets(event.nativeEvent)}
      />
      {width > 0 ? <View pointerEvents="none" style={{ width, alignSelf: 'stretch' }} /> : null}
    </>
  );
}
