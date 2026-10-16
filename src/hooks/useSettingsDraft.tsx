import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  createSettingsDraft,
  settingsDraftDirty,
  synchronizeSettingsDraft,
  acknowledgeSettingsDraft,
  resetSettingsDraft,
} from "@/lib/settings-workspace";

const DraftContext = createContext<(id: string, dirty: boolean) => void>(() => {});
export function SettingsDraftProvider({
  children,
  onDirtyChange,
}: {
  children: ReactNode;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [dirtyForms, setDirtyForms] = useState<Record<string, boolean>>({});
  const report = useCallback(
    (id: string, dirty: boolean) =>
      setDirtyForms((forms) => (forms[id] === dirty ? forms : { ...forms, [id]: dirty })),
    [],
  );
  useEffect(() => {
    onDirtyChange(Object.values(dirtyForms).some(Boolean));
  }, [dirtyForms, onDirtyChange]);
  return <DraftContext.Provider value={report}>{children}</DraftContext.Provider>;
}

export function useSettingsDraft<T extends object>(
  id: string,
  scope: string,
  empty: T,
  source: T | undefined,
) {
  const report = useContext(DraftContext);
  const [state, setState] = useState(() => createSettingsDraft(scope, empty, source));
  const visible = state.scope === scope ? state : createSettingsDraft(scope, empty, source);
  const dirty = settingsDraftDirty(visible);
  useEffect(() => {
    setState((current) => synchronizeSettingsDraft(current, scope, empty, source));
  }, [scope, empty, source]);
  useEffect(() => {
    report(id, dirty);
    return () => report(id, false);
  }, [report, id, dirty]);
  const setDraft = useCallback(
    (value: SetStateAction<T>) =>
      setState((current) => {
        const working =
          current.scope === scope ? current : createSettingsDraft(scope, empty, source);
        const draft =
          typeof value === "function" ? (value as (previous: T) => T)(working.draft) : value;
        return { ...working, draft };
      }),
    [scope, empty, source],
  );
  const acknowledge = useCallback(
    (saved: Partial<T>) =>
      setState((current) =>
        current.scope === scope ? acknowledgeSettingsDraft(current, saved) : current,
      ),
    [scope],
  );
  const reset = useCallback(
    () =>
      setState((current) =>
        current.scope === scope
          ? resetSettingsDraft(current)
          : createSettingsDraft(scope, empty, source),
      ),
    [scope, empty, source],
  );
  return useMemo(
    () => ({ draft: visible.draft, loaded: visible.loaded, dirty, setDraft, acknowledge, reset }),
    [visible.draft, visible.loaded, dirty, setDraft, acknowledge, reset],
  );
}
