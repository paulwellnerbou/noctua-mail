import { useSyncExternalStore } from "react";

type SelectionSnapshot = {
  ids: Set<string>;
  activeId: string | null;
};

export type SelectionStore = {
  getSnapshot: () => SelectionSnapshot;
  subscribe: (listener: () => void) => () => void;
  setSelection: (ids: Set<string>, activeId?: string | null) => void;
  toggle: (id: string, replace?: boolean) => void;
  clearSelection: () => void;
  setActiveId: (id: string | null) => void;
  getIds: () => Set<string>;
  getActiveId: () => string | null;
};

export const createSelectionStore = (
  initialActiveId: string | null = null
): SelectionStore => {
  let snapshot: SelectionSnapshot = { ids: new Set(), activeId: initialActiveId };
  const listeners = new Set<() => void>();

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const setSnapshot = (next: SelectionSnapshot) => {
    snapshot = next;
    emit();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSelection: (ids, activeId = snapshot.activeId) => {
      setSnapshot({ ids: new Set(ids), activeId });
    },
    toggle: (id, replace = false) => {
      const nextIds = replace ? new Set<string>() : new Set(snapshot.ids);
      if (replace) {
        nextIds.add(id);
      } else if (nextIds.has(id)) {
        nextIds.delete(id);
      } else {
        nextIds.add(id);
      }
      setSnapshot({ ids: nextIds, activeId: id });
    },
    clearSelection: () => {
      setSnapshot({ ids: new Set(), activeId: snapshot.activeId });
    },
    setActiveId: (id) => {
      if (snapshot.activeId === id) return;
      setSnapshot({ ids: snapshot.ids, activeId: id });
    },
    getIds: () => snapshot.ids,
    getActiveId: () => snapshot.activeId
  };
};

export const useSelectionSnapshot = (store: SelectionStore) =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
