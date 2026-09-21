// Runs only under `bun run test:dom`, which preloads lib/testSetupDom.ts to
// register happy-dom before any component module loads.
import { describe, expect, it } from "bun:test";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import type { Message } from "@/lib/data";
import ComposeOrchestrator from "./ComposeOrchestrator";

type ApiCall = { url: string; method: string; body?: unknown; signal?: AbortSignal | null };

type RenderComposeOptions = {
  smtpResponse?: Response | (() => Response | Promise<Response>);
  reportError?: (message: string) => void;
  readErrorMessage?: (response: Response) => Promise<string>;
  updateKeywordFlag?: (message: Message, keyword: string, value: boolean) => void | Promise<void>;
  ensureMessageContent?: (message: Message) => Promise<Message | null | undefined>;
  attachmentResponse?: () => Response | Promise<Response>;
  holdDraftSaves?: boolean;
  detachedWindow?: boolean;
  showComposeInline?: boolean;
  showComposeModal?: boolean;
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
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as unknown
      : undefined;
    calls.push({ url, method: init?.method ?? "GET", body, signal: init?.signal });

    if (url.includes("/attachments/") && options.attachmentResponse) {
      return options.attachmentResponse();
    }
    if (url.includes("/drafts/save")) {
      // Hold the save open so the pre-send flush blocks, reproducing the slow
      // IMAP APPEND the user hit.
      if (options.holdDraftSaves ?? true) await draftSaveGate.promise;
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
    updateKeywordFlag: options.updateKeywordFlag ?? (() => {}),
    accountFolders: [],
    findSentFolder: () => null,
    syncFolderWithBackgroundRef: { current: async () => {} },
    getPreferredComposeTab: () => undefined,
    isDraftMessage: () => false,
    ensureMessageContent: options.ensureMessageContent ?? (async () => null),
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
    showComposeInline: options.showComposeInline ?? false,
    showComposeModal: options.showComposeModal ?? true,
    showComposeMinimized: false,
    detachedWindow: options.detachedWindow ?? false
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

  return {
    view,
    props,
    handleRef,
    calls,
    draftSaveGate,
    sendButton,
    countSmtpSends,
    countDraftSaves
  };
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

describe("detached compose semantics", () => {
  it("renders the existing inline compose card without the modal header", async () => {
    const { view, props, handleRef } = renderCompose({
      detachedWindow: true,
      showComposeInline: true,
      showComposeModal: false
    });
    const inlineCard = handleRef.current?.renderInlineCard();
    view.rerender(
      <Theme>
        <ComposeOrchestrator ref={handleRef} {...props} />
        {inlineCard}
      </Theme>
    );

    await act(async () => {
      await handleRef.current?.openDetachedCompose(null, {
        mode: "new",
        sourceMessage: null
      });
    });

    await waitFor(() => {
      expect(view.baseElement.querySelector("#compose-inline-to")).not.toBeNull();
    });
    expect(view.baseElement.querySelector("#compose-modal-to")).toBeNull();
    expect(view.getByText("New message")).toBeTruthy();
    expect(view.queryByLabelText("Close composer")).toBeNull();
    expect(view.queryByLabelText("Open composer in new window")).toBeNull();
    expect(view.getByLabelText("Open in modal")).toBeTruthy();

    cleanup();
  });

  it("retains forward metadata when a saved handoff is reopened", async () => {
    const forwardedFlags: Array<{ messageId: string; keyword: string; value: boolean }> = [];
    const { view, handleRef, calls, sendButton } = renderCompose({
      updateKeywordFlag: (message, keyword, value) => {
        forwardedFlags.push({ messageId: message.id, keyword, value });
      }
    });
    const source = {
      id: "source-1",
      accountId: "acc-test",
      folderId: "folder-inbox",
      threadId: "thread-1",
      messageId: "<source-1@example.test>",
      subject: "Original",
      from: "sender@example.test",
      to: "me@example.test",
      preview: "Original body",
      date: "2026-08-14T10:00:00.000Z",
      dateValue: 1,
      body: "Original body"
    } as Message;
    const draft = {
      ...source,
      id: "draft-forward-1",
      folderId: "folder-drafts",
      draft: true,
      to: "recipient@example.test",
      subject: "Fwd: Original",
      body: "Forwarded note",
      xComposeFormat: "text",
      xForwardedMessageId: source.messageId
    } as Message;

    await act(async () => {
      await handleRef.current?.openDetachedCompose(draft, {
        mode: "forward",
        sourceMessage: source
      });
    });
    await act(async () => {
      fireEvent.click(sendButton()!);
    });

    await waitFor(() => {
      expect(calls.filter((call) => call.url.includes("/smtp/send"))).toHaveLength(1);
    });
    const smtpCall = calls.find((call) => call.url.includes("/smtp/send"));
    expect(smtpCall?.body).toMatchObject({
      to: "recipient@example.test",
      xForwardedMessageId: "<source-1@example.test>"
    });
    expect(forwardedFlags).toEqual([
      { messageId: "source-1", keyword: "$Forwarded", value: true }
    ]);

    cleanup();
  });
});

describe("forwarding a mail with a large attachment", () => {
  const source = {
    id: "source-big",
    accountId: "acc-test",
    folderId: "folder-inbox",
    threadId: "thread-big",
    messageId: "<source-big@example.test>",
    subject: "Big file",
    from: "sender@example.test",
    to: "me@example.test",
    preview: "See attached",
    date: "2026-08-14T10:00:00.000Z",
    dateValue: 1,
    body: "See attached",
    attachments: [
      {
        id: "att-big",
        filename: "big.pdf",
        contentType: "application/pdf",
        size: 25_000_000,
        inline: false
      }
    ]
  } as Message;

  const attachmentFetches = (calls: ApiCall[]) =>
    calls.filter((call) => call.url.includes("/attachments/att-big"));
  // Plain snapshot rather than the element: a failed matcher on a DOM node
  // makes bun pretty-print the whole happy-dom graph, which stalls `waitFor`.
  const sendState = (root: HTMLElement) => {
    const button = [...root.querySelectorAll("button")].find((candidate) =>
      /^(Send|Loading attachments…)$/.test((candidate.textContent ?? "").trim())
    );
    return button
      ? { label: (button.textContent ?? "").trim(), disabled: button.disabled }
      : null;
  };

  it("opens at once, blocks Send and auto-save until the bytes arrive, then saves them", async () => {
    const download = deferred<Response>();
    const { view, handleRef, calls, countDraftSaves } = renderCompose({
      attachmentResponse: () => download.promise,
      holdDraftSaves: false
    });

    // Three impatient clicks while the first open is still initializing.
    await act(async () => {
      handleRef.current?.openCompose("forward", source);
      handleRef.current?.openCompose("forward", source);
      handleRef.current?.openCompose("forward", source);
    });

    const toField = view.baseElement.querySelector<HTMLInputElement>("#compose-modal-to");
    expect(toField).not.toBeNull();
    expect(attachmentFetches(calls)).toHaveLength(1);
    expect(view.getByText(/Loading…/)).toBeTruthy();
    expect(sendState(view.baseElement)).toEqual({
      label: "Loading attachments…",
      disabled: true
    });

    await act(async () => {
      fireEvent.change(toField!, { target: { value: "someone@example.test" } });
    });
    // Longer than the auto-save debounce: a save here would store a draft
    // without the file.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    expect(countDraftSaves()).toBe(0);

    await act(async () => {
      download.resolve(new Response(new Blob(["%PDF"], { type: "application/pdf" })));
    });

    await waitFor(() => {
      expect(sendState(view.baseElement)).toEqual({ label: "Send", disabled: false });
    });
    await waitFor(() => expect(countDraftSaves()).toBe(1), { timeout: 5000 });
    const saved = calls.find((call) => call.url.includes("/drafts/save"))?.body as {
      attachments?: Array<{ id: string; dataUrl?: string; loadStatus?: string }>;
    };
    expect(saved.attachments).toHaveLength(1);
    expect(saved.attachments?.[0]?.dataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect(saved.attachments?.[0]?.loadStatus).toBeUndefined();

    cleanup();
  }, 20000);

  it("aborts the download on Cancel and never saves a draft", async () => {
    const download = deferred<Response>();
    const { view, handleRef, calls, countDraftSaves } = renderCompose({
      attachmentResponse: () => download.promise,
      holdDraftSaves: false
    });

    await act(async () => {
      await handleRef.current?.openCompose("forward", source);
    });
    const [fetchCall] = attachmentFetches(calls);
    expect(fetchCall?.signal?.aborted).toBe(false);

    await act(async () => {
      fireEvent.click(view.getByText("Cancel"));
    });
    expect(fetchCall?.signal?.aborted).toBe(true);

    await act(async () => {
      download.resolve(new Response(new Blob(["%PDF"], { type: "application/pdf" })));
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    expect(countDraftSaves()).toBe(0);

    cleanup();
  }, 20000);

  it("keeps Send blocked after a failed download until it is retried", async () => {
    const errors: string[] = [];
    let attempts = 0;
    const { view, handleRef } = renderCompose({
      attachmentResponse: () => {
        attempts += 1;
        return attempts === 1
          ? new Response("nope", { status: 502 })
          : new Response(new Blob(["%PDF"], { type: "application/pdf" }));
      },
      reportError: (message) => errors.push(message)
    });

    await act(async () => {
      await handleRef.current?.openCompose("forward", source);
    });
    await waitFor(() => expect(view.getByText(/Failed to load/)).toBeTruthy());
    expect(sendState(view.baseElement)).toEqual({ label: "Send", disabled: true });

    await act(async () => {
      fireEvent.click(view.getByLabelText("Retry loading attachment: big.pdf"));
    });
    await waitFor(() => {
      expect(sendState(view.baseElement)).toEqual({ label: "Send", disabled: false });
    });
    expect(view.queryByText(/Failed to load/)).toBeNull();
    expect(errors).toEqual([]);

    cleanup();
  }, 20000);
});

describe("compose initialization errors", () => {
  it("reports hydration failures without rejecting fire-and-forget callers", async () => {
    const errors: string[] = [];
    const { view, handleRef } = renderCompose({
      ensureMessageContent: async () => {
        throw new Error("hydration failed");
      },
      reportError: (message) => errors.push(message)
    });
    const source = {
      id: "source-without-content",
      accountId: "acc-test",
      folderId: "folder-inbox",
      subject: "Needs hydration",
      from: "sender@example.test",
      to: "me@example.test",
      preview: "",
      date: "2026-08-14T10:00:00.000Z",
      dateValue: 1,
      body: "",
      htmlBody: ""
    } as Message;

    await act(async () => {
      await handleRef.current?.openCompose("reply", source);
    });

    expect(errors).toEqual(["Failed to open composer: hydration failed"]);
    cleanup();
  });
});
