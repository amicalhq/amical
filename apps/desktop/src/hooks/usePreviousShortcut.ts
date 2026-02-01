import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";

const STORAGE_KEY = "previous-shortcut";

export function usePreviousShortcut() {
  const [previousKeys, setPreviousKeys] = useLocalStorage<number[]>(
    STORAGE_KEY,
    [],
  );

  const savePrevious = useCallback(
    (keys: number[]) => {
      if (keys.length > 0) {
        setPreviousKeys(keys);
      }
    },
    [setPreviousKeys],
  );

  const restorePrevious = useCallback(() => {
    const keys = previousKeys;
    setPreviousKeys([]);
    return keys;
  }, [previousKeys, setPreviousKeys]);

  const clearPrevious = useCallback(() => {
    setPreviousKeys([]);
  }, [setPreviousKeys]);

  return {
    previousKeys,
    savePrevious,
    restorePrevious,
    clearPrevious,
    hasPrevious: previousKeys.length > 0,
  };
}
