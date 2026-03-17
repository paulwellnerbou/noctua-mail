"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

type MessageLinkPreviewHandler = (url: string | null) => void;

const noopMessageLinkPreviewHandler: MessageLinkPreviewHandler = () => {};

const MessageLinkPreviewContext = createContext<MessageLinkPreviewHandler>(
  noopMessageLinkPreviewHandler
);

export function MessageLinkPreviewProvider({
  value,
  children
}: {
  value: MessageLinkPreviewHandler;
  children: ReactNode;
}) {
  return (
    <MessageLinkPreviewContext.Provider value={value}>
      {children}
    </MessageLinkPreviewContext.Provider>
  );
}

export function useMessageLinkPreview() {
  return useContext(MessageLinkPreviewContext);
}
