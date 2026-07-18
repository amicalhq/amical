import type {
  ServiceManager,
  ServiceMap,
} from "@/main/managers/service-manager";
import type { OnboardingService } from "@/services/onboarding-service";

/**
 * Resolved-service access for routers: `ctx.services.x` instead of the
 * service-locator calls the routers used to make.
 *
 * Properties are LAZY getters over the boot handle, resolving on access — a
 * partially-initialized graph behaves exactly like the old per-call
 * getService (throws until the graph is built). The test harness's
 * failed-init tolerance depends on that laziness; do not eager-resolve
 * these. transcriptionService/nativeBridge are honestly `| null` per
 * ServiceMap.
 */
export type ContextServices = Readonly<ServiceMap>;

export interface Context {
  logger: ReturnType<ServiceManager["getLogger"]>;
  services: ContextServices;
  /**
   * Nullable-accessor parity for the onboarding router: readable mid-init
   * and on a failed boot (early ref), unlike the throwing `services`
   * getters.
   */
  onboardingServiceOrNull: () => OnboardingService | null;
}

export function createContext(serviceManager: ServiceManager): Context {
  return {
    logger: serviceManager.getLogger(),
    services: {
      get posthogClient() {
        return serviceManager.getService("posthogClient");
      },
      get telemetryService() {
        return serviceManager.getService("telemetryService");
      },
      get featureFlagService() {
        return serviceManager.getService("featureFlagService");
      },
      get remoteConfigService() {
        return serviceManager.getService("remoteConfigService");
      },
      get modelService() {
        return serviceManager.getService("modelService");
      },
      get transcriptionService() {
        return serviceManager.getService("transcriptionService");
      },
      get settingsService() {
        return serviceManager.getService("settingsService");
      },
      get authService() {
        return serviceManager.getService("authService");
      },
      get vadService() {
        return serviceManager.getService("vadService");
      },
      get nativeBridge() {
        return serviceManager.getService("nativeBridge");
      },
      get autoUpdaterService() {
        return serviceManager.getService("autoUpdaterService");
      },
      get recordingManager() {
        return serviceManager.getService("recordingManager");
      },
      get shortcutManager() {
        return serviceManager.getService("shortcutManager");
      },
      get windowManager() {
        return serviceManager.getService("windowManager");
      },
      get onboardingService() {
        return serviceManager.getService("onboardingService");
      },
    },
    onboardingServiceOrNull: () => serviceManager.getOnboardingService(),
  };
}
