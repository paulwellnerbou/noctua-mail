import type React from "react";

type MessageListPaneProps = {
  state: {
    listWidth: number;
  };
  refs: {
    listPaneRef: React.RefObject<HTMLDivElement | null>;
  };
  children: React.ReactNode;
};

export default function MessageListPane({ state, refs, children }: MessageListPaneProps) {
  const { listWidth } = state;
  const { listPaneRef } = refs;

  return (
    <aside className="pane list-pane" style={{ width: listWidth }} ref={listPaneRef}>
      {children}
    </aside>
  );
}
