import type React from "react";

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
    <section className="message-view-pane">
      <div className="message-view-toolbar">
        <button className="icon-button small" onClick={onShowJson}>
          Show JSON
        </button>
        <button
          className="icon-button small"
          onClick={onEvictThreadCache}
          title="Evict cached thread data"
          aria-label="Evict thread cache"
        >
          Evict Thread Cache
        </button>
      </div>
      <div className="thread-view">{children}</div>
    </section>
  );
}
