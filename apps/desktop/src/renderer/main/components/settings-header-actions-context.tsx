import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useRouter } from "@tanstack/react-router";

type SettingsNavigationContextValue = {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
};

type SettingsHeaderActionsContextValue = {
  actions: ReactNode | null;
  setActions: (actions: ReactNode | null) => void;
  navigation: SettingsNavigationContextValue;
};

const SettingsHeaderActionsContext =
  createContext<SettingsHeaderActionsContextValue | null>(null);

export function SettingsHeaderProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [actions, setActions] = useState<ReactNode | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    const HISTORY_KEY = "navigation-history";
    const INDEX_KEY = "navigation-index";

    let history: string[] = JSON.parse(
      sessionStorage.getItem(HISTORY_KEY) || "[]",
    );

    if (history.length === 0) {
      history = [router.state.location.pathname];
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      sessionStorage.setItem(INDEX_KEY, "0");
    }

    const updateNavigationState = () => {
      const storedHistory = JSON.parse(
        sessionStorage.getItem(HISTORY_KEY) || "[]",
      );
      const storedIndex = parseInt(
        sessionStorage.getItem(INDEX_KEY) || "0",
        10,
      );

      setCanGoBack(storedIndex > 0);
      setCanGoForward(storedIndex < storedHistory.length - 1);
    };

    let isNavigatingProgrammatically = false;

    const handleNavigation = () => {
      const currentPath = router.state.location.pathname;
      let storedHistory: string[] = JSON.parse(
        sessionStorage.getItem(HISTORY_KEY) || "[]",
      );
      let storedIndex = parseInt(sessionStorage.getItem(INDEX_KEY) || "0", 10);

      if (isNavigatingProgrammatically) {
        isNavigatingProgrammatically = false;
      } else {
        const previousPath = storedHistory[storedIndex - 1];
        const nextPath = storedHistory[storedIndex + 1];

        if (previousPath === currentPath) {
          storedIndex = Math.max(0, storedIndex - 1);
        } else if (nextPath === currentPath) {
          storedIndex = Math.min(storedHistory.length - 1, storedIndex + 1);
        } else {
          storedHistory = storedHistory.slice(0, storedIndex + 1);
          storedHistory.push(currentPath);
          storedIndex = storedHistory.length - 1;
        }

        sessionStorage.setItem(HISTORY_KEY, JSON.stringify(storedHistory));
        sessionStorage.setItem(INDEX_KEY, storedIndex.toString());
      }

      updateNavigationState();
    };

    updateNavigationState();

    const unsubscribe = router.subscribe("onResolved", handleNavigation);
    const originalBack = router.history.back.bind(router.history);
    const originalForward = router.history.forward.bind(router.history);

    router.history.back = () => {
      const storedIndex = parseInt(
        sessionStorage.getItem(INDEX_KEY) || "0",
        10,
      );
      if (storedIndex > 0) {
        isNavigatingProgrammatically = true;
        sessionStorage.setItem(INDEX_KEY, (storedIndex - 1).toString());
        originalBack();
      }
    };

    router.history.forward = () => {
      const storedHistory = JSON.parse(
        sessionStorage.getItem(HISTORY_KEY) || "[]",
      );
      const storedIndex = parseInt(
        sessionStorage.getItem(INDEX_KEY) || "0",
        10,
      );

      if (storedIndex < storedHistory.length - 1) {
        isNavigatingProgrammatically = true;
        sessionStorage.setItem(INDEX_KEY, (storedIndex + 1).toString());
        originalForward();
      }
    };

    return () => {
      unsubscribe();
      router.history.back = originalBack;
      router.history.forward = originalForward;
    };
  }, [router]);

  const goBack = useCallback(() => {
    router.history.back();
  }, [router]);

  const goForward = useCallback(() => {
    router.history.forward();
  }, [router]);

  const value = useMemo(
    () => ({
      actions,
      setActions,
      navigation: {
        canGoBack,
        canGoForward,
        goBack,
        goForward,
      },
    }),
    [actions, canGoBack, canGoForward, goBack, goForward],
  );

  return (
    <SettingsHeaderActionsContext.Provider value={value}>
      {children}
    </SettingsHeaderActionsContext.Provider>
  );
}

export function useSettingsHeaderActions(): SettingsHeaderActionsContextValue {
  const context = useContext(SettingsHeaderActionsContext);
  if (!context) {
    throw new Error(
      "useSettingsHeaderActions must be used within SettingsHeaderProvider",
    );
  }

  return context;
}
