/**
 * Client-side per-message translation state shared between the message-view
 * orchestrator (which owns the map and the fetch handlers) and
 * `ThreadMessageCard` (which renders it).
 *
 * "html" translates the HTML body (DeepL tag handling); "text" translates the
 * plain body and backs both the Text and Markdown panels.
 */
export type MessageTranslationFormat = "html" | "text";

export type MessageTranslationResult = {
  text: string;
  detectedSourceLang: string;
};

export type MessageTranslationEntry = {
  /** Whether the translated view is currently shown for this message. */
  showing: boolean;
  /** Active DeepL target language for this message. */
  targetLang: string;
  status: "idle" | "loading" | "error";
  error?: string;
  /** Fetched translations keyed by `${format}:${targetLang}`. */
  results: Record<string, MessageTranslationResult>;
};

export function translationResultKey(
  format: MessageTranslationFormat,
  targetLang: string
): string {
  return `${format}:${targetLang}`;
}
