import { describe, expect, it } from "bun:test";
import { collectThreadReferenceIds, resolveThreadingForItems } from "@/lib/threading";

describe("resolveThreadingForItems", () => {
  it("groups imap-632ae6d858baf62738db3e1e style Jira replies by shared in-reply-to root", () => {
    const rootMessageId = "<JIRA.130941.1766394302000@Atlassian.JIRA>";
    const refs = [
      rootMessageId,
      "<JIRA.130941.1766394302744@jira.ext-svc.subshell.io>"
    ];
    const items = [
      {
        id: "imap-632ae6d858baf62738db3e1e",
        dateValue: 1772029800143,
        messageId: "<JIRA.130941.1766394302000.2345.1772029800143@Atlassian.JIRA>",
        inReplyTo: rootMessageId,
        references: refs,
        threadId: "<JIRA.130941.1766394302000.2345.1772029800143@Atlassian.JIRA>"
      },
      {
        id: "imap-992ccc4189d132fef7f3d541",
        dateValue: 1772029861986,
        messageId: "<JIRA.130941.1766394302000.2356.1772029861986@Atlassian.JIRA>",
        inReplyTo: rootMessageId,
        references: refs,
        threadId: "<JIRA.130941.1766394302000.2356.1772029861986@Atlassian.JIRA>"
      },
      {
        id: "imap-989db586377af2eeafd9e91e",
        dateValue: 1772029861335,
        messageId: "<JIRA.130941.1766394302000.2351.1772029861335@Atlassian.JIRA>",
        inReplyTo: rootMessageId,
        references: refs,
        threadId: "<JIRA.130941.1766394302000.2351.1772029861335@Atlassian.JIRA>"
      },
      {
        id: "imap-3206c0935df5c33a69c9aca0",
        dateValue: 1772029862121,
        messageId: "<JIRA.130941.1766394302000.2357.1772029862121@Atlassian.JIRA>",
        inReplyTo: rootMessageId,
        references: refs,
        threadId: "<JIRA.130941.1766394302000.2357.1772029862121@Atlassian.JIRA>"
      }
    ];

    const resolved = resolveThreadingForItems(items);
    resolved.forEach((item) => {
      expect(item.threadId).toBe(rootMessageId);
      expect(item.parentId).toBeUndefined();
    });
  });

  it("groups imap-e5f148364d8b7b74270d923d style Jira replies by shared in-reply-to root", () => {
    const rootMessageId = "<JIRA.131957.1770301916000@Atlassian.JIRA>";
    const refs = [
      rootMessageId,
      "<JIRA.131957.1770301916320@jira.ext-svc.subshell.io>"
    ];
    const items = [
      {
        id: "imap-e5f148364d8b7b74270d923d",
        dateValue: 1772107380078,
        messageId: "<JIRA.131957.1770301916000.4957.1772107380078@Atlassian.JIRA>",
        inReplyTo: rootMessageId,
        references: refs,
        threadId: "<JIRA.131957.1770301916000.4957.1772107380078@Atlassian.JIRA>"
      },
      {
        id: "imap-a22e3a2da072e76cea1eb20f",
        dateValue: 1772109120122,
        messageId: "<JIRA.131957.1770301916000.5044.1772109120122@Atlassian.JIRA>",
        inReplyTo: rootMessageId,
        references: refs,
        threadId: "<JIRA.131957.1770301916000.5044.1772109120122@Atlassian.JIRA>"
      },
      {
        id: "imap-de563a49b998b78894264ed9",
        dateValue: 1772109240116,
        messageId: "<JIRA.131957.1770301916000.5065.1772109240116@Atlassian.JIRA>",
        inReplyTo: rootMessageId,
        references: refs,
        threadId: "<JIRA.131957.1770301916000.5065.1772109240116@Atlassian.JIRA>"
      }
    ];

    const resolved = resolveThreadingForItems(items);
    resolved.forEach((item) => {
      expect(item.threadId).toBe(rootMessageId);
      expect(item.parentId).toBeUndefined();
    });
  });

  it("applies external thread and parent mappings for single-message resolution", () => {
    const rootMessageId = "<root@example.com>";
    const message = {
      id: "imap-single",
      dateValue: 100,
      messageId: "<child@example.com>",
      inReplyTo: rootMessageId,
      references: [rootMessageId],
      threadId: "<child@example.com>"
    };

    const [resolved] = resolveThreadingForItems([message], {
      externalThreadIds: new Map([[rootMessageId, "<shared-thread@example.com>"]]),
      externalParentIds: new Map([[rootMessageId, "imap-root"]])
    });

    expect(resolved.threadId).toBe("<shared-thread@example.com>");
    expect(resolved.parentId).toBe("imap-root");
  });

  it("merges GitLab note replies into an existing merge-request thread by shared references", () => {
    const mergeRequestId = "<merge_request_462663618@gitlab.com>";
    const discussionId = "<note_3153489529@gitlab.com>";
    const items = [
      {
        id: "imap-mr-update",
        dateValue: 1773238813000,
        messageId: "<b3e49f0eec7a9e7bb4f2c4814093fef3@gitlab.com>",
        inReplyTo: mergeRequestId,
        references: ["<reply-3-epc133l0c6bgkjcj37xbfwgsz@gitlab.com>", mergeRequestId],
        threadId: mergeRequestId
      },
      {
        id: "imap-note-root",
        dateValue: 1773238872000,
        messageId: discussionId,
        inReplyTo: mergeRequestId,
        references: ["<reply-3-b0qecshn7yl48sqqmhc7c3dw0@gitlab.com>", mergeRequestId],
        threadId: discussionId
      },
      {
        id: "imap-note-reply",
        dateValue: 1773305371000,
        messageId: "<note_3153555479@gitlab.com>",
        inReplyTo: discussionId,
        references: [
          "<reply-3-8qzfa0w60rkdmapb4bs21i60b@gitlab.com>",
          mergeRequestId,
          "<note_3150793383@gitlab.com>",
          discussionId
        ],
        threadId: discussionId
      }
    ];

    const resolved = resolveThreadingForItems(items);
    expect(resolved.map((item) => item.threadId)).toEqual([
      mergeRequestId,
      mergeRequestId,
      mergeRequestId
    ]);
    expect(resolved[2]?.parentId).toBe("imap-note-root");
  });
});

describe("collectThreadReferenceIds", () => {
  it("collects de-duplicated reference ids from in-reply-to and references", () => {
    const rootMessageId = "<root@example.com>";
    const ids = collectThreadReferenceIds([
      { inReplyTo: rootMessageId, references: [rootMessageId, "<a@example.com>"] },
      { inReplyTo: " ", references: ["<a@example.com>", "<b@example.com>"] }
    ]);
    expect(ids).toEqual([rootMessageId, "<a@example.com>", "<b@example.com>"]);
  });
});
