import type {
  ServiceManager,
  ServiceMap,
} from "@/main/managers/service-manager";

/**
 * Resolved-service access for routers: `ctx.services.x`.
 *
 * createContext runs per tRPC request, and requests can only arrive after a
 * window exists — strictly after the graph builds — so the bundle read here
 * can never observe a partial graph. Pre-build, services() throws,
 * preserving the throw-until-built contract the test harness pins.
 * transcriptionService/nativeBridge are honestly `| null` per ServiceMap.
 */
export type ContextServices = Readonly<ServiceMap>;

export interface Context {
  logger: ReturnType<ServiceManager["getLogger"]>;
  services: ContextServices;
}

export function createContext(serviceManager: ServiceManager): Context {
  return {
    logger: serviceManager.getLogger(),
    services: serviceManager.services(),
  };
}
