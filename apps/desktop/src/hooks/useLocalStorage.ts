import { useState, useEffect } from "react";

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      localStorage.removeItem(key);
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      if (JSON.stringify(storedValue) === JSON.stringify(initialValue)) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(storedValue));
      }
    } catch {
      // Silently fail - localStorage may be unavailable or full
    }
  }, [key, storedValue, initialValue]);

  return [storedValue, setStoredValue];
}
