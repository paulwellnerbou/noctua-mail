import { RefObject } from "react";
import type { Message } from "@/lib/data";
import { SelectionStore } from "./messagelist/selectionStore";

interface UseMessageDragDropProps {
  selectionStore: SelectionStore;
  messages: Message[];
  activeAccountId: string;
  setDraggingMessageIds: (ids: Set<string>) => void;
  setDragOverFolderId: (id: string | null) => void;
  dragImageRef: RefObject<HTMLElement | null>;
}

export function useMessageDragDrop({
  selectionStore,
  messages,
  activeAccountId,
  setDraggingMessageIds,
  setDragOverFolderId,
  dragImageRef
}: UseMessageDragDropProps) {
  const buildDragPreview = (dragMessages: Message[]) => {
    if (dragImageRef.current) {
      document.body.removeChild(dragImageRef.current);
      dragImageRef.current = null;
    }
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    const count = dragMessages.length;
    const title = dragMessages[0]?.subject ?? "Message";
    ghost.textContent = count > 1 ? `${count} messages` : title;
    document.body.appendChild(ghost);
    dragImageRef.current = ghost;
    return ghost;
  };

  const handleMessageDragStart = (
    event: React.DragEvent,
    message: Message,
    threadMessageIds?: string[]
  ) => {
    const selected = selectionStore.getIds();
    const selectedIds = Array.from(selected);
    const hasThreadMessageIds = Boolean(threadMessageIds && threadMessageIds.length > 0);
    // Dragging a collapsed thread root should move the whole thread even if only the root is selected.
    const shouldUseThreadMessageIds =
      hasThreadMessageIds &&
      (selected.size === 0 || (selected.size === 1 && selected.has(message.id)));
    const ids =
      shouldUseThreadMessageIds
        ? threadMessageIds!
        : selected.size > 0 && selected.has(message.id)
          ? selectedIds
          : hasThreadMessageIds
            ? threadMessageIds!
          : [message.id];
    const uniqueIds = Array.from(new Set(ids));
    const items = messages.filter((item) => uniqueIds.includes(item.id));
    const ghost = buildDragPreview(items);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/json",
      JSON.stringify({ accountId: activeAccountId, messageIds: uniqueIds })
    );
    event.dataTransfer.setDragImage(ghost, 26, 26);
    setDraggingMessageIds(new Set(uniqueIds));
  };

  const handleMessageDragEnd = () => {
    setDraggingMessageIds(new Set<string>());
    setDragOverFolderId(null);
    if (dragImageRef.current) {
      document.body.removeChild(dragImageRef.current);
      dragImageRef.current = null;
    }
  };

  return {
    handleMessageDragStart,
    handleMessageDragEnd
  };
}
