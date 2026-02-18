import type React from "react";
import { Button } from "@radix-ui/themes";
import styles from "./MessageViewPane.module.css";

type MessageViewPaneProps = {
  onShowJson: () => void;
  onEvictThreadCache: () => void;
  children: React.ReactNode;
  hideToolbar?: boolean;
};

export default function MessageViewPane({
  onShowJson,
  onEvictThreadCache,
  children,
  hideToolbar = false
}: MessageViewPaneProps) {
  return (
    <section className={styles.pane}>
      {!hideToolbar && (
        <div className={styles.toolbar}>
          <span className={styles.shortcutHint}>
            Shortcuts: <kbd className={styles.keycap}>del</kbd>/<kbd className={styles.keycap}>←</kbd>{" "}
            delete, <kbd className={styles.keycap}>r</kbd> read, <kbd className={styles.keycap}>u</kbd>{" "}
            unread, <kbd className={styles.keycap}>f</kbd> flag/unflag,{" "}
            <kbd className={styles.keycap}>t</kbd> todo/done
          </span>
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
      )}
      <div className={styles.threadView}>{children}</div>
    </section>
  );
}
