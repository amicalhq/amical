import { Data } from "effect";

import type { CloudRequestError } from "../types/errors/cloud-request";

export class ActivityReportingContractFailure extends Data.TaggedError(
  "ActivityReportingContractFailure",
)<{
  message: string;
  phase: "request" | "batch";
  cause: unknown;
}> {}

export class ActivityReportingDependencyFailure extends Data.TaggedError(
  "ActivityReportingDependencyFailure",
)<{
  message: string;
  dependency: "authentication" | "database";
  cause: unknown;
}> {}

export type ActivityReportingClientError =
  | CloudRequestError
  | ActivityReportingContractFailure
  | ActivityReportingDependencyFailure;
