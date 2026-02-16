import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

type SettingsHeaderActionsContextValue = {
  actions: ReactNode | null;
  setActions: (actions: ReactNode | null) => void;
};

const SettingsHeaderActionsContext =
  createContext<SettingsHeaderActionsContextValue | null>(null);

export function SettingsHeaderProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);

  const value = useMemo(
    () => ({
      actions,
      setActions,
    }),
    [actions],
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
