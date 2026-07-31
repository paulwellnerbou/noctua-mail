import { describe, expect, it } from "bun:test";
import {
  promoteUnreferencedInlineAttachments,
  pruneUnreferencedInlineAttachments,
  restoreComposeMessageAttachmentDataUrls,
  restoreInlineAttachmentDataUrls,
  routeDroppedFiles
} from "./useComposeHandlers";
import type { PendingImageDrop } from "./composeTypes";

describe("restoreInlineAttachmentDataUrls", () => {
  it("replaces inline attachment URLs with hydrated data URLs", () => {
    const html =
      '<p>Hello</p><img src="/api/accounts/acc-1/messages/draft-1/attachments/att-inline">';
    const output = restoreInlineAttachmentDataUrls(html, [
      {
        id: "att-inline",
        filename: "logo.png",
        contentType: "image/png",
        size: 123,
        inline: true,
        url: "/api/accounts/acc-1/messages/draft-1/attachments/att-inline",
        dataUrl: "data:image/png;base64,AAAA"
      }
    ]);

    expect(output).toContain("data:image/png;base64,AAAA");
    expect(output).not.toContain("/api/accounts/acc-1/messages/draft-1/attachments/att-inline");
  });

  it("ignores non-inline attachments", () => {
    const html = '<a href="/api/accounts/acc-1/messages/draft-1/attachments/att-1">file</a>';
    const output = restoreInlineAttachmentDataUrls(html, [
      {
        id: "att-1",
        filename: "file.txt",
        contentType: "text/plain",
        size: 12,
        inline: false,
        url: "/api/accounts/acc-1/messages/draft-1/attachments/att-1",
        dataUrl: "data:text/plain;base64,SGVsbG8="
      }
    ]);

    expect(output).toBe(html);
  });

  it("replaces cid references with hydrated data URLs", () => {
    const output = restoreInlineAttachmentDataUrls(
      '<p>Hello</p><img src="cid:logo-cid@example.test">',
      [
        {
          id: "att-inline",
          filename: "logo.png",
          contentType: "image/png",
          size: 123,
          inline: true,
          cid: "logo-cid@example.test",
          dataUrl: "data:image/png;base64,AAAA"
        }
      ]
    );

    expect(output).toContain("data:image/png;base64,AAAA");
    expect(output).not.toContain("cid:logo-cid@example.test");
  });

  it("does not corrupt attachment URLs with shared prefixes", () => {
    const output = restoreInlineAttachmentDataUrls(
      [
        '<img src="/api/accounts/acc-1/messages/msg-1/attachments/att-1">',
        '<img src="/api/accounts/acc-1/messages/msg-1/attachments/att-10">',
        '<img src="/api/accounts/acc-1/messages/msg-1/attachments/att-15">'
      ].join(""),
      [
        {
          id: "att-1",
          filename: "logo.png",
          contentType: "image/png",
          size: 123,
          inline: true,
          cid: "logo",
          url: "/api/accounts/acc-1/messages/msg-1/attachments/att-1",
          dataUrl: "data:image/png;base64,AAAA"
        },
        {
          id: "att-10",
          filename: "barcode.gif",
          contentType: "image/gif",
          size: 456,
          inline: true,
          cid: "barcode",
          url: "/api/accounts/acc-1/messages/msg-1/attachments/att-10",
          dataUrl: "data:image/gif;base64,BBBB"
        },
        {
          id: "att-15",
          filename: "button.png",
          contentType: "image/png",
          size: 789,
          inline: true,
          cid: "button",
          url: "/api/accounts/acc-1/messages/msg-1/attachments/att-15",
          dataUrl: "data:image/png;base64,CCCC"
        }
      ]
    );

    expect(output).toContain('src="data:image/png;base64,AAAA"');
    expect(output).toContain('src="data:image/gif;base64,BBBB"');
    expect(output).toContain('src="data:image/png;base64,CCCC"');
    expect(output).not.toContain("AAAA0");
    expect(output).not.toContain("AAAA5");
  });
});

describe("restoreComposeMessageAttachmentDataUrls", () => {
  it("restores forwarded inline attachment URLs back to data URLs", () => {
    const output = restoreComposeMessageAttachmentDataUrls(
      {
        id: "msg-1",
        threadId: "thread-1",
        subject: "Hello",
        from: "alice@example.com",
        to: "me@example.com",
        preview: "Hello",
        date: "Mon, 1 Jan 2024 12:00:00 +0000",
        dateValue: 1704110400000,
        folderId: "inbox",
        accountId: "acc-1",
        body: "Hello",
        htmlBody: '<p>Hello</p><img src="/api/accounts/acc-1/messages/msg-1/attachments/att-inline">'
      },
      [
        {
          id: "att-inline",
          filename: "logo.png",
          contentType: "image/png",
          size: 123,
          inline: true,
          url: "/api/accounts/acc-1/messages/msg-1/attachments/att-inline",
          dataUrl: "data:image/png;base64,AAAA"
        }
      ]
    );

    expect(output.htmlBody).toContain("data:image/png;base64,AAAA");
    expect(output.htmlBody).not.toContain("/api/accounts/acc-1/messages/msg-1/attachments/att-inline");
  });
});

describe("promoteUnreferencedInlineAttachments", () => {
  const inlineAttachment = (overrides: Record<string, unknown> = {}) => ({
    id: "att-inline",
    filename: "Flyer Kochevent.jpeg",
    contentType: "image/jpeg",
    size: 503944,
    inline: true,
    url: "/api/accounts/acc-1/messages/msg-1/attachments/att-inline",
    ...overrides
  });

  it("demotes inline attachments of a mail without an html body", () => {
    expect(promoteUnreferencedInlineAttachments([inlineAttachment()], "")).toEqual([
      inlineAttachment({ inline: false })
    ]);
  });

  it("demotes inline attachments the html body never references", () => {
    expect(
      promoteUnreferencedInlineAttachments(
        [inlineAttachment()],
        "<p>No image reference here</p>"
      )
    ).toEqual([inlineAttachment({ inline: false })]);
  });

  it("keeps inline attachments referenced by attachment url", () => {
    const attachments = [inlineAttachment()];
    expect(
      promoteUnreferencedInlineAttachments(
        attachments,
        '<img src="/api/accounts/acc-1/messages/msg-1/attachments/att-inline">'
      )
    ).toEqual(attachments);
  });

  it("keeps inline attachments referenced via cid", () => {
    const attachments = [inlineAttachment({ cid: "logo-cid@example.test" })];
    expect(
      promoteUnreferencedInlineAttachments(
        attachments,
        '<img src="cid:logo-cid@example.test">'
      )
    ).toEqual(attachments);
  });

  it("leaves regular attachments untouched", () => {
    const attachments = [
      inlineAttachment({ id: "att-file", filename: "contract.pdf", inline: false })
    ];
    expect(promoteUnreferencedInlineAttachments(attachments, "")).toEqual(attachments);
  });
});

describe("pruneUnreferencedInlineAttachments", () => {
  it("keeps inline attachments referenced from quoted html", () => {
    const attachments = [
      {
        id: "att-inline",
        filename: "logo.png",
        contentType: "image/png",
        size: 123,
        inline: true,
        dataUrl: "data:image/png;base64,AAAA"
      },
      {
        id: "att-file",
        filename: "contract.pdf",
        contentType: "application/pdf",
        size: 2048,
        inline: false,
        dataUrl: "data:application/pdf;base64,BBBB"
      }
    ];

    expect(
      pruneUnreferencedInlineAttachments(
        attachments,
        '<div id="noctua-quoted-html"><img src="data:image/png;base64,AAAA"></div>'
      )
    ).toEqual(attachments);
  });

  it("drops inline attachments that are no longer referenced", () => {
    expect(
      pruneUnreferencedInlineAttachments(
        [
          {
            id: "att-inline",
            filename: "logo.png",
            contentType: "image/png",
            size: 123,
            inline: true,
            dataUrl: "data:image/png;base64,AAAA"
          },
          {
            id: "att-file",
            filename: "contract.pdf",
            contentType: "application/pdf",
            size: 2048,
            inline: false,
            dataUrl: "data:application/pdf;base64,BBBB"
          }
        ],
        "<p>No inline image here</p>"
      )
    ).toEqual([
      {
        id: "att-file",
        filename: "contract.pdf",
        contentType: "application/pdf",
        size: 2048,
        inline: false,
        dataUrl: "data:application/pdf;base64,BBBB"
      }
    ]);
  });
});

describe("routeDroppedFiles", () => {
  const imageFile = (name: string) => new File([], name, { type: "image/png" });
  const otherFile = (name: string) => new File([], name, { type: "application/pdf" });

  function setup() {
    const attached: Array<{ files: File[]; inline?: boolean }> = [];
    const pending: Array<PendingImageDrop | null> = [];
    return {
      attached,
      pending,
      deps: {
        addComposeFiles: (files: File[], inline?: boolean) => attached.push({ files, inline }),
        setPendingImageDrop: (drop: PendingImageDrop | null) => pending.push(drop)
      }
    };
  }

  it("queues images in pendingImageDrop and does not attach them", () => {
    const { attached, pending, deps } = setup();
    const a = imageFile("a.png");
    const b = imageFile("b.png");

    routeDroppedFiles([a, b], 10, 20, deps);

    expect(attached).toEqual([]);
    expect(pending).toEqual([{ files: [a, b], x: 10, y: 20 }]);
  });

  it("attaches non-images immediately without queuing a drop", () => {
    const { attached, pending, deps } = setup();
    const doc = otherFile("contract.pdf");

    routeDroppedFiles([doc], 0, 0, deps);

    expect(attached).toEqual([{ files: [doc], inline: false }]);
    expect(pending).toEqual([]);
  });

  it("splits a mixed drop: attaches non-images and queues images", () => {
    const { attached, pending, deps } = setup();
    const img = imageFile("photo.png");
    const doc = otherFile("contract.pdf");

    routeDroppedFiles([doc, img], 5, 6, deps);

    expect(attached).toEqual([{ files: [doc], inline: false }]);
    expect(pending).toEqual([{ files: [img], x: 5, y: 6 }]);
  });

  it("does nothing for an empty drop", () => {
    const { attached, pending, deps } = setup();

    routeDroppedFiles([], 0, 0, deps);

    expect(attached).toEqual([]);
    expect(pending).toEqual([]);
  });

  it("attaches non-embeddable image types (e.g. PSD) instead of offering embed", () => {
    const { attached, pending, deps } = setup();
    const psd = new File([], "art.psd", { type: "image/vnd.adobe.photoshop" });

    routeDroppedFiles([psd], 5, 6, deps);

    expect(attached).toEqual([{ files: [psd], inline: false }]);
    expect(pending).toEqual([]);
  });
});
