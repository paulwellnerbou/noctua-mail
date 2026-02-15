import type React from "react";
import { Maximize2, X } from "lucide-react";
import styles from "./Compose.module.css";

type ComposeMinimizedProps = {
  open: boolean;
  composeSubject: string;
  setComposeView: React.Dispatch<React.SetStateAction<"inline" | "modal" | "minimized">>;
  setComposeOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export default function ComposeMinimized({
  open,
  composeSubject,
  setComposeView,
  setComposeOpen
}: ComposeMinimizedProps) {
  if (!open) return null;

  return (
    <div
      className={styles.composeMinimized}
      role="button"
      tabIndex={0}
      onClick={() => setComposeView("modal")}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setComposeView("modal");
        }
      }}
    >
      <span className={styles.composeMinimizedTitle}>
        {composeSubject.trim() || "New message"}
      </span>
      <div className={styles.composeMinimizedActions}>
        <button
          className="icon-button small"
          title="Restore"
          aria-label="Restore"
          onClick={(event) => {
            event.stopPropagation();
            setComposeView("modal");
          }}
        >
          <Maximize2 size={12} />
        </button>
        <button
          className="icon-button small"
          title="Close composer"
          aria-label="Close composer"
          onClick={(event) => {
            event.stopPropagation();
            setComposeOpen(false);
            setComposeView("inline");
          }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
