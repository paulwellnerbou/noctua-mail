// Runs only under `bun run test:dom`, which preloads lib/testSetupDom.ts to
// register happy-dom before any component module loads.
import { describe, expect, it } from "bun:test";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import ComposeOrchestrator from "./ComposeOrchestrator";

type ApiCall = { url: string; method: string };

type RenderComposeOptions = {
  smtpResponse?: Response | (() => Response | Promise<Response>);
  reportError?: (message: string) => void;
  readErrorMessage?: (response: Response) => Promise<string>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Every caller passes a path string today, but reading `.url`/`.href` keeps the
 * stub from silently matching nothing (and the test from silently passing) if
 * one ever switches to a Request or URL — `String(new Request(...))` is
 * "[object Request]".
 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Renders the real ComposeOrchestrator with stub collaborators. Everything the
 * send path touches arrives through props, so the draft-save and SMTP calls can
 * be driven from the test without touching the network.
 */
function renderCompose(options: RenderComposeOptions = {}) {
  const calls: ApiCall[] = [];
  const draftSaveGate = deferred<void>();

  const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    calls.push({ url, method: init?.method ?? "GET" });

    if (url.includes("/drafts/save")) {
      // Hold the save open so the pre-send flush blocks, reproducing the slow
      // IMAP APPEND the user hit.
      await draftSaveGate.promise;
      return jsonResponse({ draftId: "draft-1", message: null });
    }
    if (url.includes("/smtp/send")) {
      if (typeof options.smtpResponse === "function") {
        return options.smtpResponse();
      }
      if (options.smtpResponse) return options.smtpResponse;
      return jsonResponse({ ok: true, sentFolderId: null, sentMessageUid: null });
    }
    return jsonResponse({ ok: true });
  };

  const handleRef = React.createRef<React.ElementRef<typeof ComposeOrchestrator>>();

  const props = {
    activeAccountId: "acc-test",
    currentAccount: null,
    accountDateFormat: "locale" as const,
    defaultSignatureId: "",
    accountSignatures: [],
    darkMode: false,
    activeThread: [],
    messageById: new Map(),
    viewMessage: null,
    searchScope: "folder",
    activeFolderId: "folder-inbox",
    isDraftsFolder: () => false,
    setMessages: () => {},
    setViewMessage: () => {},
    setActiveMessageId: () => {},
    suppressDraftDeleteReconcile: () => {},
    removeDraftFromUi: () => {},
    reconcileSavedDraftInUi: () => {},
    refreshFolders: async () => {},
    refreshMailboxData: async () => {},
    pushNotice: () => {},
    evictThreadCache: () => {},
    updateFlagState: () => {},
    updateKeywordFlag: () => {},
    accountFolders: [],
    findSentFolder: () => null,
    syncFolderWithBackgroundRef: { current: async () => {} },
    getPreferredComposeTab: () => undefined,
    isDraftMessage: () => false,
    ensureMessageContent: async () => null,
    applyRecipientSelection: (current: string) => current,
    loadRecipientOptions: async () => [],
    clearRecipientSuggestionCache: () => {},
    getComposeToken: (value: string) => value,
    formatRelativeTime: () => "just now",
    fromValue: "me@example.test",
    apiFetch,
    reportError: options.reportError ?? (() => {}),
    readErrorMessage: options.readErrorMessage ?? (async () => "error"),
    stripHtml: (value: string) => value,
    showComposeInline: false,
    showComposeModal: true,
    showComposeMinimized: false
  } as unknown as React.ComponentProps<typeof ComposeOrchestrator>;

  const view = render(
    <Theme>
      <ComposeOrchestrator ref={handleRef} {...props} />
    </Theme>
  );

  const sendButton = () =>
    [...view.baseElement.querySelectorAll("button")].find((button) =>
      /^(Send|Sending\.\.\.)$/.test((button.textContent ?? "").trim())
    );

  const countSmtpSends = () => calls.filter((call) => call.url.includes("/smtp/send")).length;
  const countDraftSaves = () => calls.filter((call) => call.url.includes("/drafts/save")).length;

  return { view, handleRef, calls, draftSaveGate, sendButton, countSmtpSends, countDraftSaves };
}

describe("send while a draft save is still in flight", () => {
  it("sends once when Send is clicked repeatedly during the pre-send draft flush", async () => {
    const { view, handleRef, draftSaveGate, sendButton, countSmtpSends, countDraftSaves } =
      renderCompose();

    await act(async () => {
      handleRef.current?.openCompose("new");
    });

    // Typing marks the compose dirty, which schedules the debounced auto-save.
    const toField = view.baseElement.querySelector<HTMLInputElement>("#compose-modal-to");
    expect(toField).not.toBeNull();
    await act(async () => {
      fireEvent.change(toField!, { target: { value: "someone@example.test" } });
    });

    // Wait for the auto-save to actually be in flight; it now blocks on the gate.
    await waitFor(() => expect(countDraftSaves()).toBe(1), { timeout: 5000 });

    // The frustrated-user sequence: the button looks unresponsive because the
    // flush is blocked, so it gets clicked three times.
    const labels: Array<{ label: string; disabled: boolean }> = [];
    for (let click = 0; click < 3; click += 1) {
      const button = sendButton();
      expect(button).toBeDefined();
      labels.push({
        label: (button!.textContent ?? "").trim(),
        disabled: (button as HTMLButtonElement).disabled
      });
      await act(async () => {
        fireEvent.click(button!);
      });
    }

    // Let the draft save settle so the flush completes and the send proceeds.
    await act(async () => {
      draftSaveGate.resolve();
    });

    // Settle on observable state rather than a delay: the handler clears
    // `sendingMail` in its finally, so an enabled button means the send ran to
    // completion. Any duplicate handler was parked on the same gate and calls
    // apiFetch well before it finishes, so its call is already counted here.
    await waitFor(
      () => {
        const button = sendButton();
        expect(button).toBeDefined();
        expect((button as HTMLButtonElement).disabled).toBe(false);
      },
      { timeout: 5000 }
    );

    // The bug: every click that landed during the flush sent its own copy.
    expect(countSmtpSends()).toBe(1);

    // The UX symptom behind it: the button kept reading "Send" and stayed
    // clickable for the whole flush, so it looked unresponsive.
    expect(labels[0]).toEqual({ label: "Send", disabled: false });
    expect(labels[1]).toEqual({ label: "Sending...", disabled: true });
    expect(labels[2]).toEqual({ label: "Sending...", disabled: true });

    cleanup();
  }, 20000);

  it("surfaces an SMTP timeout and re-enables Send after the request fails", async () => {
    const errors: string[] = [];
    const timeoutMessage =
      "Timed out while connecting to the outgoing mail server. Check the SMTP server and firewall settings, then try again.";
    const { view, handleRef, draftSaveGate, sendButton, countSmtpSends } = renderCompose({
      smtpResponse: new Response(
        JSON.stringify({
          ok: false,
          message: timeoutMessage,
          code: "smtp_connection_timeout"
        }),
        { status: 504, headers: { "Content-Type": "application/json" } }
      ),
      reportError: (message) => errors.push(message),
      readErrorMessage: async (response) => {
        const body = (await response.json()) as { message?: string };
        return body.message ?? `Request failed (${response.status})`;
      }
    });

    await act(async () => {
      handleRef.current?.openCompose("new");
    });

    const toField = view.baseElement.querySelector<HTMLInputElement>("#compose-modal-to");
    expect(toField).not.toBeNull();
    await act(async () => {
      fireEvent.change(toField!, { target: { value: "someone@example.test" } });
    });
    await act(async () => {
      fireEvent.click(sendButton()!);
    });

    await act(async () => {
      draftSaveGate.resolve();
    });

    await waitFor(() => expect(errors).toEqual([timeoutMessage]), { timeout: 5000 });
    expect(countSmtpSends()).toBe(1);
    expect((sendButton()?.textContent ?? "").trim()).toBe("Send");
    expect((sendButton() as HTMLButtonElement).disabled).toBe(false);

    cleanup();
  }, 20000);
});
