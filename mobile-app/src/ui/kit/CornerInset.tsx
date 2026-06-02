import { useState } from 'react';

import {
  NativeCornerInsetView,
  type CornerInsets,
  type CornerInsetsChangeEvent,
} from '../../../modules/corner-inset';

const ZERO: CornerInsets = { leading: 0, trailing: 0, top: 0 };

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
export function CornerInset({ edge = 'leading' }: { edge?: 'leading' | 'trailing' }) {
  const [insets, setInsets] = useState<CornerInsets>(ZERO);

  if (!NativeCornerInsetView) return null;

  const width = edge === 'leading' ? insets.leading : insets.trailing;
  return (
    <NativeCornerInsetView
      pointerEvents="none"
      style={{ width, alignSelf: 'stretch' }}
      onInsetsChange={(event: CornerInsetsChangeEvent) => setInsets(event.nativeEvent)}
    />
  );
}
