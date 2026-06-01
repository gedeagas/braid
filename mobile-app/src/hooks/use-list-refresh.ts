import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import type { RefObject } from 'react';

type ScrollableListRef = {
  scrollTo?: (options: { y: number; animated?: boolean }) => void;
  scrollToOffset?: (options: { offset: number; animated?: boolean }) => void;
};

const scrollMemory = new Map<string, number>();

function restoreScroll(ref: RefObject<unknown>, key: string) {
  const offset = scrollMemory.get(key) ?? 0;
  requestAnimationFrame(() => {
    const listRef = ref.current as ScrollableListRef | null;
    if (listRef?.scrollToOffset) {
      listRef.scrollToOffset({ offset, animated: false });
      return;
    }
    listRef?.scrollTo?.({ y: offset, animated: false });
  });
}

export function useListRefresh<T = unknown>(
  key: string,
  refresh: () => Promise<void> | void,
  enabled = true,
) {
  const scrollRef = useRef<T | null>(null);
  const offsetRef = useRef(0);
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    offsetRef.current = offset;
    scrollMemory.set(key, offset);
  }, [key]);

  const refreshNow = useCallback(async () => {
    if (!enabled) return;
    scrollMemory.set(key, offsetRef.current);
    await refreshRef.current();
    restoreScroll(scrollRef, key);
  }, [enabled, key]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      void refreshNow();
      return () => {
        scrollMemory.set(key, offsetRef.current);
      };
    }, [enabled, key, refreshNow]),
  );

  useEffect(() => {
    if (!enabled) return;
    void refreshNow();
  }, [enabled, refreshNow]);

  return { scrollRef, onScroll, refreshNow };
}
