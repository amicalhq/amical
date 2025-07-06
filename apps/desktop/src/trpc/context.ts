import type { ServiceManager } from "@/main/managers/service-manager";

export interface Context {
  serviceManager: ServiceManager;
}

export function createContext(serviceManager: ServiceManager): Context {
  return {
    serviceManager,
  };
}
