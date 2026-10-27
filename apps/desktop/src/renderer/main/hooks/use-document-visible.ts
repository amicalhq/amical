import { useEffect, useState } from "react";

/** True while the document is not hidden (window shown, not minimized). */
export function useDocumentVisible() {
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const onVisibilityChange = () => {
      setVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
  return visible;
}
