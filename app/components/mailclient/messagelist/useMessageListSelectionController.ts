import { startTransition, useCallback, useEffect } from "react";
import type React from "react";
import type { Message } from "@/lib/data";
import type { VisibleMessageEntry } from "./listModel";
import {
  clearListSelection,
  resolveCollapsedThreadSelectionTarget,
  selectRangeToMessage,
  toggleListMessageSelection
} from "./listSelection";
import { logListDebug, summarizeMessageForListDebug } from "./listDebug";
import type { SelectionStore } from "./selectionStore";

type ThreadFlatEntry = { message: Message; depth: number };

type UseMessageListSelectionControllerParams = {
  selectionStore: SelectionStore;
  lastSelectedIdRef: React.MutableRefObject<string | null>;
  visibleIndexByIdRef: React.MutableRefObject<Map<string, number>>;
  visibleMessagesRef: React.MutableRefObject<VisibleMessageEntry[]>;
  activeMessageId: string;
  setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;
  messageById: Map<string, Message>;
  isFlaggedMessage: (message: Message) => boolean;
  onBeforeSelectMessage?: (nextMessage: Message, currentMessage: Message | null) => void;
};

export function useMessageListSelectionController({
  selectionStore,
  lastSelectedIdRef,
  visibleIndexByIdRef,
  visibleMessagesRef,
  activeMessageId,
  setActiveMessageId,
  messageById,
  isFlaggedMessage,
  onBeforeSelectMessage
}: UseMessageListSelectionControllerParams) {
  const setLastSelectedIdRef = useCallback(
    (id: string | null) => {
      lastSelectedIdRef.current = id;
    },
    [lastSelectedIdRef]
  );

  const selectRangeTo = useCallback(
    (messageId: string) => {
      selectRangeToMessage({
        messageId,
        lastSelectedId: lastSelectedIdRef.current,
        indexMap: visibleIndexByIdRef.current,
        visibleMessages: visibleMessagesRef.current,
        selectionStore,
        setLastSelectedId: (id) => {
          setLastSelectedIdRef(id);
        }
      });
    },
    [lastSelectedIdRef, selectionStore, setLastSelectedIdRef, visibleIndexByIdRef, visibleMessagesRef]
  );

  const clearSelection = useCallback(() => {
    clearListSelection({
      selectionStore,
      setLastSelectedId: (id) => {
        setLastSelectedIdRef(id);
      }
    });
  }, [selectionStore, setLastSelectedIdRef]);

  const toggleMessageSelection = useCallback(
    (messageId: string, replace = false, setActive = true) => {
      toggleListMessageSelection({
        messageId,
        replace,
        setActive,
        selectionStore,
        setLastSelectedId: (id) => {
          setLastSelectedIdRef(id);
        }
      });
    },
    [selectionStore, setLastSelectedIdRef]
  );

  const handleSelectMessage = useCallback(
    (message: Message, options?: { preserveSelection?: boolean }) => {
      const currentMessage = activeMessageId ? messageById.get(activeMessageId) ?? null : null;
      onBeforeSelectMessage?.(message, currentMessage);
      if (!options?.preserveSelection) {
        const current = selectionStore.getIds();
        if (!(current.size === 1 && current.has(message.id))) {
          selectionStore.setSelection(new Set([message.id]), message.id);
        } else {
          selectionStore.setActiveId(message.id);
        }
        setLastSelectedIdRef(message.id);
      }
      selectionStore.setActiveId(message.id);
      startTransition(() => setActiveMessageId(message.id));
    },
    [
      activeMessageId,
      messageById,
      onBeforeSelectMessage,
      selectionStore,
      setActiveMessageId,
      setLastSelectedIdRef
    ]
  );

  const handleRowClick = useCallback(
    (event: React.MouseEvent, message: Message) => {
      const selectedCountBefore = selectionStore.getIds().size;
      const action = event.shiftKey
        ? "range-select"
        : event.metaKey || event.ctrlKey
          ? "toggle-select"
          : "open-message";
      logListDebug("info", "row click", {
        action,
        modifiers: {
          shift: event.shiftKey,
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          alt: event.altKey
        },
        activeMessageIdBefore: activeMessageId || null,
        selectedCountBefore,
        message: summarizeMessageForListDebug(message)
      });
      if (event.shiftKey) {
        event.preventDefault();
        selectRangeTo(message.id);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        toggleMessageSelection(message.id, false, false);
        return;
      }
      handleSelectMessage(message);
    },
    [activeMessageId, handleSelectMessage, selectRangeTo, selectionStore, toggleMessageSelection]
  );

  const selectCollapsedThread = useCallback(
    (flat: ThreadFlatEntry[], target: Message, options?: { isFlaggedGroup?: boolean }) => {
      const effectiveTarget = resolveCollapsedThreadSelectionTarget({
        flat,
        target,
        isFlaggedMessage,
        options
      });
      selectionStore.setSelection(new Set([effectiveTarget.id]), effectiveTarget.id);
      setLastSelectedIdRef(effectiveTarget.id);
      handleSelectMessage(effectiveTarget, { preserveSelection: true });
    },
    [handleSelectMessage, isFlaggedMessage, selectionStore, setLastSelectedIdRef]
  );

  useEffect(() => {
    selectionStore.setActiveId(activeMessageId);
  }, [activeMessageId, selectionStore]);

  return {
    setLastSelectedIdRef,
    selectRangeTo,
    clearSelection,
    toggleMessageSelection,
    handleSelectMessage,
    handleRowClick,
    selectCollapsedThread
  };
}
