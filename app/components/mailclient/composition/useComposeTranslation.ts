"use client";

import { useCallback, useRef, useState } from "react";
import type React from "react";
import { buildAccountComposeTranslatePath } from "@/lib/accountApiPaths";
import { normalizeDeeplTargetLang } from "@/lib/deeplLanguages";
import type { ComposeTab } from "./composeTypes";

// Written when the user picks a compose target language, so the next compose
// session starts from the language they last translated a draft into (which is
// the recipient's language, unlike the account-level read-side target).
const TARGET_LANG_STORAGE_KEY = "noctua.composeTranslateTargetLang";

export type ComposeTranslationStatus = "idle" | "loading" | "done" | "error";

/** Pre-translation snapshot of every tab's content, restored by Revert. */
type ComposeTranslationStash = {
  tab: ComposeTab;
  body: string;
  html: string;
  htmlText: string;
  markdown: string;
};

type ComposeTranslationState = {
  status: ComposeTranslationStatus;
  /** The language the current "done" result was translated into. */
  translatedTo: string;
  detectedSourceLang: string;
  error: string | null;
  stash: ComposeTranslationStash | null;
};

export type ComposeTranslationUi = {
  enabled: boolean;
  status: ComposeTranslationStatus;
  targetLang: string;
  translatedTo: string;
  detectedSourceLang: string;
  error: string | null;
  canRevert: boolean;
};

const IDLE_STATE: ComposeTranslationState = {
  status: "idle",
  translatedTo: "",
  detectedSourceLang: "",
  error: null,
  stash: null
};

function readStoredTargetLang(): string {
  if (typeof window === "undefined") return normalizeDeeplTargetLang(undefined);
  try {
    return normalizeDeeplTargetLang(window.localStorage.getItem(TARGET_LANG_STORAGE_KEY));
  } catch {
    return normalizeDeeplTargetLang(undefined);
  }
}

type UseComposeTranslationArgs = {
  activeAccountId: string;
  enabled: boolean;
  composeTab: ComposeTab;
  composeBody: string;
  composeHtml: string;
  composeHtmlText: string;
  composeTextRef: React.RefObject<HTMLTextAreaElement | null>;
  composeMarkdownRef: React.MutableRefObject<string>;
  composeBodyDebounceRef: React.MutableRefObject<NodeJS.Timeout | null>;
  composeDirtyRef: React.MutableRefObject<boolean>;
  composeLastEditedRef: React.MutableRefObject<ComposeTab>;
  composeSessionVersionRef: React.MutableRefObject<number>;
  setComposeBody: React.Dispatch<React.SetStateAction<string>>;
  setComposeHtml: React.Dispatch<React.SetStateAction<string>>;
  setComposeHtmlText: React.Dispatch<React.SetStateAction<string>>;
  setComposeMarkdown: React.Dispatch<React.SetStateAction<string>>;
  setComposeEditorReset: React.Dispatch<React.SetStateAction<number>>;
  stripHtml: (value: string) => string;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

/**
 * DeepL translation of the draft being composed. Owns the request lifecycle,
 * the target-language choice, and a pre-translation stash so the user can
 * revert. Translation replaces the active tab's content in place (the user
 * reviews and edits the result before sending).
 */
export function useComposeTranslation({
  activeAccountId,
  enabled,
  composeTab,
  composeBody,
  composeHtml,
  composeHtmlText,
  composeTextRef,
  composeMarkdownRef,
  composeBodyDebounceRef,
  composeDirtyRef,
  composeLastEditedRef,
  composeSessionVersionRef,
  setComposeBody,
  setComposeHtml,
  setComposeHtmlText,
  setComposeMarkdown,
  setComposeEditorReset,
  stripHtml,
  apiFetch
}: UseComposeTranslationArgs) {
  const [state, setState] = useState<ComposeTranslationState>(IDLE_STATE);
  const [targetLang, setTargetLangState] = useState(readStoredTargetLang);
  // Invalidates in-flight responses on newer requests and on session resets.
  const requestSeqRef = useRef(0);
  // Ref mirrors so the async response handler sees current values, not the
  // ones captured when the request started.
  const composeTabRef = useRef(composeTab);
  composeTabRef.current = composeTab;
  const stateRef = useRef(state);
  stateRef.current = state;

  const setTargetLang = useCallback((lang: string) => {
    const normalized = normalizeDeeplTargetLang(lang);
    setTargetLangState(normalized);
    try {
      window.localStorage.setItem(TARGET_LANG_STORAGE_KEY, normalized);
    } catch {
      // Persisting the preference is best-effort.
    }
  }, []);

  const clearBodyDebounce = useCallback(() => {
    if (composeBodyDebounceRef.current) {
      clearTimeout(composeBodyDebounceRef.current);
      composeBodyDebounceRef.current = null;
    }
  }, [composeBodyDebounceRef]);

  const translate = useCallback(async (liveHtml?: { html: string; text: string }) => {
    const tab = composeTabRef.current;
    // Read every tab from its live source, not React state: the plain textarea
    // is uncontrolled, markdown state updates are debounced, and the HTML
    // editor's export is deferred to an animation frame that a throttled
    // window may not have run yet.
    const body = composeTextRef.current?.value ?? composeBody;
    const markdown = composeMarkdownRef.current;
    const html = liveHtml?.html ?? composeHtml;
    const htmlText = liveHtml?.text ?? composeHtmlText;
    const sourceText = tab === "html" ? html : tab === "markdown" ? markdown : body;
    // An empty Lexical document still exports markup (`<p><br></p>`), so judge
    // emptiness by the text content, not the HTML.
    const emptinessProbe = tab === "html" ? htmlText : sourceText;
    if (!emptinessProbe.trim()) {
      setState((prev) => ({ ...prev, status: "error", error: "There is no content to translate." }));
      return;
    }
    const format = tab === "html" ? "html" : "text";
    const lang = targetLang;
    const session = composeSessionVersionRef.current;
    const seq = ++requestSeqRef.current;
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    const isStale = () =>
      requestSeqRef.current !== seq || composeSessionVersionRef.current !== session;
    try {
      const res = await apiFetch(buildAccountComposeTranslatePath(activeAccountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sourceText, targetLang: lang, format })
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; translatedText?: string; detectedSourceLang?: string; message?: string }
        | null;
      if (isStale()) return;
      if (!res.ok || !data?.ok || typeof data.translatedText !== "string") {
        throw new Error(data?.message ?? "Translation failed.");
      }
      if (composeTabRef.current !== tab) {
        // The user switched tabs mid-flight. Applying now would bump the
        // editor reset and remount the other tab's editor over its unflushed
        // edits — drop the result instead. An earlier translation's stash (and
        // its banner) survives so Revert stays available for content that is
        // still translated.
        setState((prev) =>
          prev.stash ? { ...prev, status: "done", error: null } : IDLE_STATE
        );
        return;
      }
      // A debounced state update queued before the click still carries
      // pre-translation text; without this it would overwrite the result.
      clearBodyDebounce();
      const translated = data.translatedText;
      if (tab === "text") {
        setComposeBody(translated);
      } else if (tab === "markdown") {
        composeMarkdownRef.current = translated;
        setComposeMarkdown(translated);
      } else {
        setComposeHtml(translated);
        // Approximation until the remounted editor reports its exported text.
        setComposeHtmlText(stripHtml(translated));
      }
      composeDirtyRef.current = true;
      composeLastEditedRef.current = tab;
      setComposeEditorReset((prev) => prev + 1);
      setState((prev) => ({
        status: "done",
        translatedTo: lang,
        detectedSourceLang: data.detectedSourceLang ?? "",
        error: null,
        // Keep the first stash of a translate chain: Revert always returns to
        // the user's own pre-translation text, not an intermediate translation.
        stash: prev.stash ?? { tab, body, html, htmlText, markdown }
      }));
    } catch (error) {
      if (isStale()) return;
      const message = error instanceof Error ? error.message : "Translation failed.";
      setState((prev) => ({ ...prev, status: "error", error: message }));
    }
  }, [
    activeAccountId,
    apiFetch,
    clearBodyDebounce,
    composeBody,
    composeDirtyRef,
    composeHtml,
    composeHtmlText,
    composeLastEditedRef,
    composeMarkdownRef,
    composeSessionVersionRef,
    composeTextRef,
    setComposeBody,
    setComposeEditorReset,
    setComposeHtml,
    setComposeHtmlText,
    setComposeMarkdown,
    stripHtml,
    targetLang
  ]);

  const revert = useCallback(() => {
    const stash = stateRef.current.stash;
    if (!stash) return;
    requestSeqRef.current += 1;
    clearBodyDebounce();
    setComposeBody(stash.body);
    setComposeHtml(stash.html);
    setComposeHtmlText(stash.htmlText);
    composeMarkdownRef.current = stash.markdown;
    setComposeMarkdown(stash.markdown);
    composeDirtyRef.current = true;
    composeLastEditedRef.current = stash.tab;
    setComposeEditorReset((prev) => prev + 1);
    setState(IDLE_STATE);
  }, [
    clearBodyDebounce,
    composeDirtyRef,
    composeLastEditedRef,
    composeMarkdownRef,
    setComposeBody,
    setComposeEditorReset,
    setComposeHtml,
    setComposeHtmlText,
    setComposeMarkdown
  ]);

  /** Drops translation state and invalidates in-flight requests. Called on
   * compose open, after send, and on session reset. */
  const reset = useCallback(() => {
    requestSeqRef.current += 1;
    setState(IDLE_STATE);
  }, []);

  /** Clears an error banner without discarding the stash — after a failed
   * retry the draft still holds the earlier translation, and Revert must
   * survive the dismissal. */
  const dismissError = useCallback(() => {
    setState((prev) =>
      prev.stash ? { ...prev, status: "done", error: null } : IDLE_STATE
    );
  }, []);

  const ui: ComposeTranslationUi = {
    enabled,
    status: state.status,
    targetLang,
    translatedTo: state.translatedTo,
    detectedSourceLang: state.detectedSourceLang,
    error: state.error,
    canRevert: state.stash !== null
  };

  return { ui, translate, revert, reset, dismissError, setTargetLang };
}
