"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";
import styles from "./ComposeMarkdownEditor.module.css";

const MDEditor = dynamic(
  () => import("@uiw/react-md-editor"),
  { ssr: false }
);

type ComposeMarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  resetKey?: number | string;
};

const DEFAULT_EDITOR_HEIGHT = 440;
const MIN_EDITOR_HEIGHT = 60;

export default function ComposeMarkdownEditor({
  value,
  onChange,
  resetKey,
}: ComposeMarkdownEditorProps) {
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  const [editorHeight, setEditorHeight] = useState(DEFAULT_EDITOR_HEIGHT);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Detect dark mode from Radix theme
  useEffect(() => {
    const updateColorMode = () => {
      const isDark = document.documentElement.classList.contains("dark");
      setColorMode(isDark ? "dark" : "light");
    };

    updateColorMode();

    // Watch for theme changes
    const observer = new MutationObserver(updateColorMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const syncHeight = (nextHeight: number) => {
      const normalizedHeight = Math.max(MIN_EDITOR_HEIGHT, Math.round(nextHeight));
      setEditorHeight((currentHeight) =>
        currentHeight === normalizedHeight ? currentHeight : normalizedHeight
      );
    };

    syncHeight(node.getBoundingClientRect().height);

    if (typeof ResizeObserver === "undefined") {
      const handleWindowResize = () => {
        syncHeight(node.getBoundingClientRect().height);
      };
      window.addEventListener("resize", handleWindowResize);
      return () => window.removeEventListener("resize", handleWindowResize);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      syncHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={styles.container} data-color-mode={colorMode}>
      <MDEditor
        value={value}
        onChange={(val) => onChange(val || "")}
        preview="live"
        height={editorHeight}
        visibleDragbar={false}
        key={resetKey}
      />
    </div>
  );
}
