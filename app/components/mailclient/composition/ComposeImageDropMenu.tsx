import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Text } from "@radix-ui/themes";
import { ImageIcon, Paperclip } from "lucide-react";
import type { PendingImageDrop } from "./composeTypes";
import styles from "./ComposeImageDropMenu.module.css";

type ComposeImageDropMenuProps = {
  drop: PendingImageDrop;
  onEmbed: () => void;
  onAttach: () => void;
  onCancel: () => void;
};

const MARGIN = 8;

export default function ComposeImageDropMenu({
  drop,
  onEmbed,
  onAttach,
  onCancel
}: ComposeImageDropMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const embedButtonRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState({ top: drop.y, left: drop.x });

  // Move focus into the dialog on open so keyboard/screen-reader users land on
  // the prompt instead of the content behind the backdrop.
  useEffect(() => {
    embedButtonRef.current?.focus();
  }, []);

  // Keep the menu inside the viewport regardless of where the drop landed.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.min(drop.x, window.innerWidth - width - MARGIN);
    const top = Math.min(drop.y, window.innerHeight - height - MARGIN);
    setPosition({ top: Math.max(MARGIN, top), left: Math.max(MARGIN, left) });
  }, [drop.x, drop.y]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      // Trap focus inside the modal dialog so Tab can't escape to the content
      // behind the backdrop.
      const menu = menuRef.current;
      if (!menu) return;
      const focusable = Array.from(menu.querySelectorAll<HTMLElement>("button"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !menu.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !menu.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const count = drop.files.length;
  const label = count === 1 ? drop.files[0]?.name || "image" : `${count} images`;

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        ref={menuRef}
        className={styles.menu}
        style={{ top: position.top, left: position.left }}
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${label}: embed in the message or attach as a file`}
        onClick={(event) => event.stopPropagation()}
      >
        <Text size="1" color="gray" className={styles.caption} truncate>
          {label}
        </Text>
        <Button ref={embedButtonRef} type="button" size="2" variant="soft" color="gray" onClick={onEmbed}>
          <ImageIcon size={14} />
          Embed in message
        </Button>
        <Button type="button" size="2" variant="soft" color="gray" onClick={onAttach}>
          <Paperclip size={14} />
          Attach as file
        </Button>
      </div>
    </div>
  );
}
