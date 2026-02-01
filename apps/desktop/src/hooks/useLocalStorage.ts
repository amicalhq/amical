import { useState, useEffect } from "react";

// Safe localStorage utilities that never throw
export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  removeItem(key: string): boolean {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const item = safeStorage.getItem(key);
    if (item === null) return initialValue;
    try {
      return JSON.parse(item);
    } catch {
      safeStorage.removeItem(key);
      return initialValue;
    }
  });

  useEffect(() => {
    safeStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}
