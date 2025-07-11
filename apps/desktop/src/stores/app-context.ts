import { GetAccessibilityContextResult } from "@amical/types";
import { ServiceManager } from "../main/managers/service-manager";
import { logger } from "../main/logger";

class AppContextStore {
  private accessibilityContext: GetAccessibilityContextResult | null = null;

  async refreshAccessibilityData(): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      if (!serviceManager) return; // Silent fail

      const swiftBridge = serviceManager.getService("swiftIOBridge");
      if (!swiftBridge) {
        logger.main.warn("SwiftIOBridge not available");
        return;
      }
      const context = await swiftBridge.call("getAccessibilityContext", {
        editableOnly: false,
      });
      this.accessibilityContext = context;

      logger.main.debug("Accessibility context refreshed", {
        hasApplication: !!context.context?.application?.name,
        hasFocusedElement: !!context.context?.focusedElement?.role,
        hasTextSelection: !!context.context?.textSelection?.selectedText,
        hasWindow: !!context.context?.windowInfo?.title,
      });
    } catch (error) {
      logger.main.error("Failed to refresh accessibility context", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getAccessibilityContext(): GetAccessibilityContextResult | null {
    return this.accessibilityContext;
  }
}

export const appContextStore = new AppContextStore();
