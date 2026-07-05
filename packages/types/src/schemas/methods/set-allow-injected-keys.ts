import { z } from "zod";

// Schema for setAllowInjectedKeys RPC method.
//
// Windows-only in effect. Controls whether the native keyboard hook honors
// *injected* keystrokes (events carrying LLKHF_INJECTED — e.g. from remote
// desktop, KVM switches, virtual keyboards, or key-remapping software) when
// matching shortcuts. Injected keys are filtered out by default; enabling this
// lets them drive shortcut matching like physical key presses.
//
// The helper always ignores its OWN injected events (the paste chord and masked
// modifier releases, tagged in dwExtraInfo) regardless of this flag, so no
// feedback loop can form. The macOS Swift helper accepts this method and no-ops.
export const SetAllowInjectedKeysParamsSchema = z.object({
  enabled: z.boolean(),
});
export type SetAllowInjectedKeysParams = z.infer<
  typeof SetAllowInjectedKeysParamsSchema
>;

export const SetAllowInjectedKeysResultSchema = z.object({
  success: z.boolean(),
});
export type SetAllowInjectedKeysResult = z.infer<
  typeof SetAllowInjectedKeysResultSchema
>;
