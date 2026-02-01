import { useState, useEffect } from "react";

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : initialValue;
  });

  useEffect(() => {
    if (JSON.stringify(storedValue) === JSON.stringify(initialValue)) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(storedValue));
    }
  }, [key, storedValue, initialValue]);

  return [storedValue, setStoredValue];
}
