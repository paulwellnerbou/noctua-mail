import { describe, expect, it } from "bun:test";
import type { Attachment } from "@/lib/data";
import type { ComposePayload } from "./composeContentBuilder";
import {
  buildDraftSavePayload,
  computeDraftHash,
  getDraftChangeState,
  hasDraftContent
} from "./draftSaveUtils";

const ATTACHMENTS: Attachment[] = [
  {
    id: "att-1",
    filename: "a.txt",
    contentType: "text/plain",
    size: 10,
    inline: false
  },
  {
    id: "att-2",
    filename: "logo.png",
    contentType: "image/png",
    size: 25,
    inline: true,
    cid: "img-1"
  }
];

describe("draftSaveUtils", () => {
  it("computes a stable hash from recipients, content, and attachment metadata", () => {
    const hash = computeDraftHash({
      to: "to@example.com",
      cc: "",
      bcc: "",
      subject: "Subject",
      text: "Body",
      html: "<p>Body</p>",
      attachments: ATTACHMENTS
    });
    expect(JSON.parse(hash)).toEqual({
      to: "to@example.com",
      cc: "",
      bcc: "",
      subject: "Subject",
      text: "Body",
      html: "<p>Body</p>",
      attachments: "a.txt:10:0:|logo.png:25:1:img-1",
      invite: null
    });
  });

  it("treats undefined html as blank in hashes", () => {
    const hash = computeDraftHash({
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      text: "Body",
      html: undefined,
      attachments: []
    });
    expect(JSON.parse(hash).html).toBe("");
  });

  it("detects whether a draft has any meaningful content", () => {
    expect(
      hasDraftContent({
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        text: "  ",
        html: "",
        attachments: []
      })
    ).toBe(false);
    expect(
      hasDraftContent({
        to: "",
        cc: "",
        bcc: "",
        subject: "Hello",
        text: "",
        html: undefined,
        attachments: []
      })
    ).toBe(true);
    expect(
      hasDraftContent({
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        text: "",
        html: undefined,
        attachments: [],
        invite: {
          start: "2026-03-27T09:00",
          end: "2026-03-27T10:00",
          allDay: false
        }
      })
    ).toBe(true);
    expect(
      hasDraftContent({
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        text: "",
        html: undefined,
        attachments: ATTACHMENTS
      })
    ).toBe(true);
  });

  it("distinguishes autosave eligibility from manual save eligibility", () => {
    expect(
      getDraftChangeState({
        draftId: null,
        lastSavedHash: "",
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        text: "",
        html: undefined,
        attachments: ATTACHMENTS
      })
    ).toMatchObject({
      hasContent: true,
      hasUnsavedChanges: true,
      canAutoSave: true,
      canManualSave: true
    });

    expect(
      getDraftChangeState({
        draftId: "draft-1",
        lastSavedHash: JSON.stringify({
          to: "",
          cc: "",
          bcc: "",
          subject: "Before",
          text: "",
          html: "",
          attachments: "",
          invite: null
        }),
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        text: "",
        html: undefined,
        attachments: []
      })
    ).toMatchObject({
      hasContent: false,
      hasUnsavedChanges: true,
      canAutoSave: false,
      canManualSave: true
    });
  });

  it("builds draft payloads with normalized html by default", () => {
    const composePayload: ComposePayload = {
      text: "Body",
      html: undefined,
      markdown: undefined,
      attachments: ATTACHMENTS,
      composeFormat: "text"
    };
    const payload = buildDraftSavePayload(
      {
        to: "to@example.com",
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        subject: "Subject",
        composeQuotedHtmlEdited: true,
        composeReplyHeaders: {
          inReplyTo: "<id-1@example.com>",
          references: ["<id-0@example.com>", "<id-1@example.com>"]
        }
      },
      composePayload
    );
    expect(payload).toEqual({
      to: "to@example.com",
      cc: "cc@example.com",
      bcc: "bcc@example.com",
      subject: "Subject",
      text: "Body",
      html: "",
      composeFormat: "text",
      quotedHtmlEdited: true,
      inReplyTo: "<id-1@example.com>",
      references: ["<id-0@example.com>", "<id-1@example.com>"],
      xForwardedMessageId: undefined,
      attachments: ATTACHMENTS
    });
  });

  it("can preserve undefined html for autosave parity", () => {
    const composePayload: ComposePayload = {
      text: "Body",
      html: undefined,
      markdown: undefined,
      attachments: [],
      composeFormat: "text"
    };
    const payload = buildDraftSavePayload(
      {
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        composeQuotedHtmlEdited: false,
        composeReplyHeaders: null
      },
      composePayload,
      { preserveUndefinedHtml: true }
    );
    expect(payload.html).toBeUndefined();
  });
});
