import { Data } from "effect";

import type { CloudRequestError } from "../types/errors/cloud-request";
import type { SyncContext } from "../db/sync";

export type SettingsSyncOperation = "bootstrap" | "pull" | "push";

export class SettingsSyncContractFailure extends Data.TaggedError(
  "SettingsSyncContractFailure",
)<{
  message: string;
  operation: SettingsSyncOperation;
  phase: "request" | "response" | "batch";
  cause: unknown;
}> {}

export class SettingsSyncDependencyFailure extends Data.TaggedError(
  "SettingsSyncDependencyFailure",
)<{
  message: string;
  dependency: "authentication" | "database";
  cause: unknown;
}> {}

export class SettingsSyncScopeRejected extends Data.TaggedError(
  "SettingsSyncScopeRejected",
)<{
  message: string;
  context: SyncContext;
}> {}

export type SettingsSyncClientError =
  | CloudRequestError
  | SettingsSyncContractFailure
  | SettingsSyncDependencyFailure;

export type SettingsSyncAttemptError =
  | SettingsSyncClientError
  | SettingsSyncScopeRejected;

export type SettingsSyncLifecycleError = SettingsSyncDependencyFailure;
