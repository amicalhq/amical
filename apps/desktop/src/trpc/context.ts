import { logger } from "@/main/logger";
import type { ServiceMap } from "@/main/managers/service-manager";

/**
 * Resolved-service access for routers: `ctx.services.x`.
 *
 * The services object is the graph's frozen bundle (ServicesBundleTag) —
 * the tRPC handler layer depends on it, so a handler (and therefore any
 * request) structurally cannot exist before the whole graph does.
 * transcriptionService/nativeBridge are honestly `| null` per ServiceMap.
 */
export type ContextServices = Readonly<ServiceMap>;

export interface Context {
  logger: typeof logger;
  services: ContextServices;
}

export function createContext(services: Readonly<ServiceMap>): Context {
  return { logger, services };
}
