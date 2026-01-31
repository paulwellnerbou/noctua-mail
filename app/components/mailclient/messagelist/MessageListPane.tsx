import type React from "react";
import styles from "./MessageListPane.module.css";

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
    <aside className={styles.pane} style={{ width: listWidth }} ref={listPaneRef}>
      {children}
    </aside>
  );
}
