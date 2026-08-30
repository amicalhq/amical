import type { SyncScopeType } from "../schema";
import type { AdvertisedSyncScope, SyncContext } from "./types";

type ActiveScopeAccess = { canWrite: boolean; role: string | null };

let localMutationHandler: (() => void) | null = null;
let activeUserAccountId: string | null = null;
const activeSyncScopes = new Map<string, ActiveScopeAccess>();

export const activeScopeKey = (
  scopeType: SyncScopeType,
  scopeId: string,
): string => `${scopeType}:${scopeId}`;

export function registerLocalSyncMutationHandler(
  handler: () => void,
): () => void {
  localMutationHandler = handler;
  return () => {
    if (localMutationHandler === handler) localMutationHandler = null;
  };
}

export function notifyLocalSyncMutation(): void {
  localMutationHandler?.();
}

export function resetActiveScopes(): void {
  activeSyncScopes.clear();
}

export function activateScope(
  accountId: string,
  scopeType: SyncScopeType,
  scopeId: string,
  access: ActiveScopeAccess,
): void {
  activeUserAccountId = accountId;
  activeSyncScopes.set(activeScopeKey(scopeType, scopeId), access);
}

export function replaceActiveScopes(
  accountId: string,
  scopes: readonly AdvertisedSyncScope[],
): boolean {
  if (activeUserAccountId !== accountId) return false;
  activeSyncScopes.clear();
  for (const scope of scopes) {
    activeSyncScopes.set(activeScopeKey(scope.scopeType, scope.scopeId), {
      canWrite: scope.canWrite,
      role: scope.role,
    });
  }
  return true;
}

export function isActiveAccount(accountId: string): boolean {
  return activeUserAccountId === accountId;
}

export function contextIsActive(context: SyncContext): boolean {
  return (
    context.accountId === activeUserAccountId &&
    activeSyncScopes.has(activeScopeKey(context.scopeType, context.scopeId))
  );
}

export function pauseActiveSyncSession(): void {
  activeUserAccountId = null;
  activeSyncScopes.clear();
}

export function deactivateActiveOrganizationScopes(): boolean {
  let changed = false;
  for (const key of activeSyncScopes.keys()) {
    if (!key.startsWith("org:")) continue;
    activeSyncScopes.delete(key);
    changed = true;
  }
  return changed;
}

export function removeActiveScope(
  scopeType: SyncScopeType,
  scopeId: string,
): void {
  activeSyncScopes.delete(activeScopeKey(scopeType, scopeId));
}

export function activeUserIdentity(): {
  scopeType: "user";
  scopeId: string;
} | null {
  if (!activeUserAccountId) return null;
  return { scopeType: "user", scopeId: activeUserAccountId };
}

export function activeWritableOrganizationIdentity(): {
  scopeType: "org";
  scopeId: string;
} | null {
  for (const [key, access] of activeSyncScopes) {
    if (!key.startsWith("org:") || !access.canWrite) continue;
    return { scopeType: "org", scopeId: key.slice(4) };
  }
  return null;
}

export function isActiveScope(
  scopeType: SyncScopeType,
  scopeId: string,
): boolean {
  return activeSyncScopes.has(activeScopeKey(scopeType, scopeId));
}
