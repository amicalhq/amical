import { useState } from "react";
import { api } from "@/trpc/react";

/**
 * Subscribes to the live held-keys stream (native OS-level key events, so it
 * includes Fn and other non-browser keys) and reports the keycodes currently
 * held. Used to light the shortcut keycaps while the shortcut is physically
 * pressed.
 */
export function useHeldKeys(): number[] {
  const [heldKeys, setHeldKeys] = useState<number[]>([]);

  api.settings.activeKeysUpdates.useSubscription(undefined, {
    onData: (keys: number[]) => setHeldKeys(keys),
  });

  return heldKeys;
}
