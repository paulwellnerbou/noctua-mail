import { useEffect, useRef } from "react";
import type React from "react";

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";
type ComposeView = "inline" | "modal" | "minimized";
type ComposeTab = "text" | "html" | "markdown";

type ComposeResizeState = {
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

type UseComposeViewEffectsParams = {
  showComposeInline: boolean;
  composeReplyMessageId: string | null;
  composeCardRef: React.RefObject<HTMLDivElement | null>;
  composeTab: ComposeTab;
  composeOpen: boolean;
  composeView: ComposeView;
  composeMode: ComposeMode;
  activeFolderId: string;
  composeModalRef: React.RefObject<HTMLDivElement | null>;
  composeTextRef: React.RefObject<HTMLTextAreaElement | null>;
  composeResizeRef: React.MutableRefObject<ComposeResizeState | null>;
  composeResizing: boolean;
  setComposeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeSize: React.Dispatch<React.SetStateAction<{ width: number; height: number | null }>>;
  setComposeResizing: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useComposeViewEffects({
  showComposeInline,
  composeReplyMessageId,
  composeCardRef,
  composeTab,
  composeOpen,
  composeView,
  composeMode,
  activeFolderId,
  composeModalRef,
  composeTextRef,
  composeResizeRef,
  composeResizing,
  setComposeOpen,
  setComposeSize,
  setComposeResizing
}: UseComposeViewEffectsParams) {
  const previousActiveFolderIdRef = useRef(activeFolderId);

  useEffect(() => {
    if (!showComposeInline || !composeReplyMessageId || !composeCardRef.current) return;
    const timer = window.setTimeout(() => {
      composeCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [showComposeInline, composeReplyMessageId, composeCardRef]);

  useEffect(() => {
    if (composeTab !== "text") return;
    if (!composeTextRef.current) return;
    const element = composeTextRef.current;
    requestAnimationFrame(() => {
      if (document.activeElement !== element) {
        element.focus();
      }
      element.setSelectionRange(0, 0);
      element.scrollTop = 0;
    });
  }, [composeTab, composeOpen, composeTextRef]);

  useEffect(() => {
    const previousActiveFolderId = previousActiveFolderIdRef.current;
    if (previousActiveFolderId === activeFolderId) return;
    previousActiveFolderIdRef.current = activeFolderId;
    if (!composeOpen || composeView !== "inline") return;
    if (composeMode === "new") return;
    setComposeOpen(false);
  }, [activeFolderId, composeOpen, composeMode, composeView, setComposeOpen]);

  useEffect(() => {
    if (!composeOpen) return;
    const timer = window.setTimeout(() => {
      const root = composeView === "modal" ? composeModalRef.current : composeCardRef.current;
      const firstField = root?.querySelector<HTMLInputElement>("input");
      firstField?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [composeOpen, composeView, composeModalRef, composeCardRef]);

  useEffect(() => {
    if (!composeResizing || composeView !== "modal") return;
    const handleMove = (event: PointerEvent) => {
      if (!composeResizeRef.current) return;
      const { startX, startY, startWidth, startHeight } = composeResizeRef.current;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      const nextWidth = Math.max(640, Math.min(window.innerWidth - 80, startWidth + deltaX));
      const nextHeight = Math.max(420, Math.min(window.innerHeight - 120, startHeight + deltaY));
      setComposeSize({ width: nextWidth, height: nextHeight });
    };
    const handleUp = () => {
      setComposeResizing(false);
      composeResizeRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [composeResizing, composeView, composeResizeRef, setComposeResizing, setComposeSize]);
}
