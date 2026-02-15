"use client";

import { useEffect, useState } from "react";
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

export default function ComposeMarkdownEditor({
  value,
  onChange,
  resetKey,
}: ComposeMarkdownEditorProps) {
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");

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

  return (
    <div className={styles.container} data-color-mode={colorMode}>
      <MDEditor
        value={value}
        onChange={(val) => onChange(val || "")}
        preview="live"
        height={440}
        visibleDragbar={true}
        key={resetKey}
      />
    </div>
  );
}
