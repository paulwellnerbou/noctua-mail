import type React from "react";
import { Button } from "@radix-ui/themes";
import styles from "./MessageViewPane.module.css";

type MessageViewPaneProps = {
  onShowJson: () => void;
  onEvictThreadCache: () => void;
  children: React.ReactNode;
};

export default function MessageViewPane({
  onShowJson,
  onEvictThreadCache,
  children
}: MessageViewPaneProps) {
  return (
    <section className={styles.pane}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarActions}>
          <Button size="1" variant="surface" onClick={onShowJson}>
            Show JSON
          </Button>
          <Button
            size="1"
            variant="surface"
            color="gray"
            onClick={onEvictThreadCache}
            title="Evict cached thread data"
            aria-label="Evict thread cache"
          >
            Evict Thread Cache
          </Button>
        </div>
      </div>
      <div className={styles.threadView}>{children}</div>
    </section>
  );
}
