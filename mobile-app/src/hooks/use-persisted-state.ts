import { useCallback, useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

/**
 * useState backed by expo-secure-store. Starts at `initial`, then adopts the
 * stored value once it loads asynchronously; every write is persisted so the
 * choice survives screen navigation and app restarts.
 */
export function usePersistedState<T extends string>(
  key: string,
  initial: T,
  isValid: (value: string) => boolean,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  // Keep the latest validator in a ref so the load effect (keyed on `key`)
  // always sees it without re-running when the caller passes a fresh function.
  // Updated in an effect, not during render, per the hooks linter.
  const isValidRef = useRef(isValid);
  useEffect(() => {
    isValidRef.current = isValid;
  });

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(key)
      .then((stored) => {
        if (active && stored && isValidRef.current(stored)) setValue(stored as T);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      void SecureStore.setItemAsync(key, next).catch(() => undefined);
    },
    [key],
  );

  return [value, set];
}
