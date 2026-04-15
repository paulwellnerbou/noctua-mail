import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DeleteConfirmAction,
  DeleteConfirmState,
  FullSyncConfirmState
} from "../types";

export type UnsubscribeConfirmState = {
  sender: string;
  listId?: string;
};

/**
 * View-facing state and handlers for the three promise-based confirmation
 * dialogs. Feed this into `<DialogsHost />`.
 */
export type ConfirmDialogsView = {
  deleteConfirm: DeleteConfirmState | null;
  resolveDeleteConfirm: (action: DeleteConfirmAction) => void;
  handleDeleteDialogOpenChange: (open: boolean) => void;

  fullSyncConfirm: FullSyncConfirmState | null;
  resolveFullSyncConfirm: (confirmed: boolean) => void;
  handleFullSyncConfirmOpenChange: (open: boolean) => void;

  unsubscribeConfirm: UnsubscribeConfirmState | null;
  resolveUnsubscribeConfirm: (confirmed: boolean) => void;
  handleUnsubscribeDialogOpenChange: (open: boolean) => void;
};

export type UseConfirmDialogsResult = {
  /** Imperative API — open the delete-confirmation dialog and await the user's action. */
  confirmDelete: (state: DeleteConfirmState) => Promise<DeleteConfirmAction>;
  /** Imperative API — open the unsubscribe-confirmation dialog. */
  confirmUnsubscribe: (sender: string, listId?: string) => Promise<boolean>;
  /** Imperative API — open the full-sync confirmation dialog. */
  confirmFullSyncStart: (state: FullSyncConfirmState) => Promise<boolean>;
  /** State + handlers that the dialog components consume. */
  view: ConfirmDialogsView;
};

/**
 * Encapsulates the three promise-based confirmation dialogs that the mail
 * client can raise from deep inside its handler tree:
 *
 *   - Delete confirmation (move / permanently delete / cancel)
 *   - Full-sync start confirmation (for IMAP accounts with many messages)
 *   - Unsubscribe confirmation
 *
 * Each `confirm*` method returns a Promise that resolves when the user picks
 * an action or dismisses the dialog. Only one dialog of each kind can be open
 * at a time — invoking a second `confirm*` before the first resolves cancels
 * the earlier invocation with the "cancel" / `false` path.
 */
export function useConfirmDialogs(): UseConfirmDialogsResult {
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const deleteConfirmResolveRef = useRef<((action: DeleteConfirmAction) => void) | null>(null);

  const [fullSyncConfirm, setFullSyncConfirm] = useState<FullSyncConfirmState | null>(null);
  const fullSyncConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const [unsubscribeConfirm, setUnsubscribeConfirm] = useState<UnsubscribeConfirmState | null>(null);
  const unsubscribeConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const resolveDeleteConfirm = useCallback((action: DeleteConfirmAction) => {
    const resolve = deleteConfirmResolveRef.current;
    deleteConfirmResolveRef.current = null;
    setDeleteConfirm(null);
    resolve?.(action);
  }, []);

  const resolveFullSyncConfirm = useCallback((confirmed: boolean) => {
    const resolve = fullSyncConfirmResolveRef.current;
    fullSyncConfirmResolveRef.current = null;
    setFullSyncConfirm(null);
    resolve?.(confirmed);
  }, []);

  const resolveUnsubscribeConfirm = useCallback((confirmed: boolean) => {
    const resolve = unsubscribeConfirmResolveRef.current;
    unsubscribeConfirmResolveRef.current = null;
    setUnsubscribeConfirm(null);
    resolve?.(confirmed);
  }, []);

  const handleDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) resolveDeleteConfirm("cancel");
    },
    [resolveDeleteConfirm]
  );

  const handleFullSyncConfirmOpenChange = useCallback(
    (open: boolean) => {
      if (!open) resolveFullSyncConfirm(false);
    },
    [resolveFullSyncConfirm]
  );

  const handleUnsubscribeDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) resolveUnsubscribeConfirm(false);
    },
    [resolveUnsubscribeConfirm]
  );

  const confirmDelete = useCallback(
    (nextDeleteConfirm: DeleteConfirmState) =>
      new Promise<DeleteConfirmAction>((resolve) => {
        if (deleteConfirmResolveRef.current) {
          deleteConfirmResolveRef.current("cancel");
        }
        deleteConfirmResolveRef.current = resolve;
        setDeleteConfirm(nextDeleteConfirm);
      }),
    []
  );

  const confirmFullSyncStart = useCallback(
    (state: FullSyncConfirmState) =>
      new Promise<boolean>((resolve) => {
        if (fullSyncConfirmResolveRef.current) {
          fullSyncConfirmResolveRef.current(false);
        }
        fullSyncConfirmResolveRef.current = resolve;
        setFullSyncConfirm(state);
      }),
    []
  );

  const confirmUnsubscribe = useCallback(
    (sender: string, listId?: string) =>
      new Promise<boolean>((resolve) => {
        if (unsubscribeConfirmResolveRef.current) {
          unsubscribeConfirmResolveRef.current(false);
        }
        unsubscribeConfirmResolveRef.current = resolve;
        setUnsubscribeConfirm({ sender, listId });
      }),
    []
  );

  // Cancel any in-flight confirmation prompts if the component unmounts so
  // the callers' Promises never hang (e.g., on navigation/logout).
  useEffect(() => {
    return () => {
      if (deleteConfirmResolveRef.current) {
        deleteConfirmResolveRef.current("cancel");
        deleteConfirmResolveRef.current = null;
      }
      if (fullSyncConfirmResolveRef.current) {
        fullSyncConfirmResolveRef.current(false);
        fullSyncConfirmResolveRef.current = null;
      }
      if (unsubscribeConfirmResolveRef.current) {
        unsubscribeConfirmResolveRef.current(false);
        unsubscribeConfirmResolveRef.current = null;
      }
    };
  }, []);

  return {
    confirmDelete,
    confirmUnsubscribe,
    confirmFullSyncStart,
    view: {
      deleteConfirm,
      resolveDeleteConfirm,
      handleDeleteDialogOpenChange,
      fullSyncConfirm,
      resolveFullSyncConfirm,
      handleFullSyncConfirmOpenChange,
      unsubscribeConfirm,
      resolveUnsubscribeConfirm,
      handleUnsubscribeDialogOpenChange
    }
  };
}
