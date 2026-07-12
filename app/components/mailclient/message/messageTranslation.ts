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
  /** Whether translated views are active for this message (vs. originals). */
  showing: boolean;
  /** Active DeepL target language for this message. */
  targetLang: string;
  /**
   * Loading/error are tracked per result key (`${format}:${targetLang}`) rather
   * than globally, so translating the HTML view doesn't make an untranslated
   * Text view look like it is loading or failed.
   */
  loadingKey?: string;
  errorKey?: string;
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
