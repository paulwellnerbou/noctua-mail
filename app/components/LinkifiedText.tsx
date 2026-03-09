import type { ReactNode } from "react";
import { splitTextWithUrls } from "@/lib/linkify";

export function linkifyText(text: string, linkClassName?: string): ReactNode[] {
  return splitTextWithUrls(text).map((segment, index) => {
    if (segment.type === "url") {
      return (
        <a key={index} href={segment.value} target="_blank" rel="noreferrer" className={linkClassName}>
          {segment.value}
        </a>
      );
    }
    return <span key={index}>{segment.value}</span>;
  });
}
