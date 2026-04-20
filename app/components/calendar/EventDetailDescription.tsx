"use client";

import { linkifyText } from "@/app/components/LinkifiedText";
import {
  enforceSafeLinks,
  linkifyHtmlTextNodes,
  sanitizeHtmlForDisplay,
  stripStyleTags
} from "@/lib/html";
import styles from "./EventDetailView.module.css";

export type EventDetailDescriptionProps = {
  description?: string;
};

function looksLikeHtml(value: string) {
  return /<\s*\/?\s*[a-z][\w:-]*(\s[^>]*?)?>/i.test(value);
}

function sanitizeDescriptionHtml(value: string) {
  return enforceSafeLinks(linkifyHtmlTextNodes(sanitizeHtmlForDisplay(stripStyleTags(value))));
}

/**
 * Renders the event description. HTML content is sanitized and safe-linked
 * before being inserted via dangerouslySetInnerHTML; plain-text content is
 * linkified so URLs become clickable.
 */
export default function EventDetailDescription({ description }: EventDetailDescriptionProps) {
  const trimmed = description?.trim() ?? "";
  if (!trimmed) return null;

  const descriptionHtml = looksLikeHtml(trimmed) ? sanitizeDescriptionHtml(trimmed) : "";
  const useHtml = Boolean(descriptionHtml);

  return (
    <div className={styles.description}>
      <span className={styles.descriptionLabel}>Description</span>
      {useHtml ? (
        <div className={styles.descriptionText} dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
      ) : (
        <span className={styles.descriptionText}>
          {linkifyText(trimmed, styles.descriptionLink)}
        </span>
      )}
    </div>
  );
}
