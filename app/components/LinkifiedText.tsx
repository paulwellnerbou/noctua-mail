import type { ReactNode } from "react";

const urlPattern = /(https?:\/\/[^\s]+)/g;

export function linkifyText(text: string, linkClassName?: string): ReactNode[] {
  const parts = text.split(urlPattern);
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={index} href={part} target="_blank" rel="noreferrer" className={linkClassName}>
          {part}
        </a>
      );
    }
    return <span key={index}>{part}</span>;
  });
}
