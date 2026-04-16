import { describe, expect, test } from "bun:test";
import {
  buildMessageListQueryUrl,
  resolveMessageListPageSize,
  type BuildMessageListQueryUrlOptions
} from "./messageListQueryUrl";
import { INVITE_DECK_GROUP_BY } from "@/lib/messageGrouping";

// Minimal baseline — tests override the fields that matter for each assertion.
const baseOpts: BuildMessageListQueryUrlOptions = {
  accountId: "acc-1",
  page: 1,
  groupBy: "date",
  searchScope: "folder",
  activeFolderId: "folder-inbox",
  currentSearchExcludedFolderIds: [],
  supportsThreads: false,
  threadDateSource: "latest",
  isRelatedSearch: false,
  relatedQueryId: "",
  query: "",
  selectedSearchFields: ["subject", "from"],
  searchBadges: { attachments: false },
  effectiveSearchBadges: []
};

function parseQuery(url: string): Record<string, string> {
  const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return Object.fromEntries(new URLSearchParams(qs));
}

describe("resolveMessageListPageSize", () => {
  test("INVITE_DECK_GROUP_BY always forces 200", () => {
    expect(resolveMessageListPageSize(INVITE_DECK_GROUP_BY, "folder")).toBe(200);
    expect(resolveMessageListPageSize(INVITE_DECK_GROUP_BY, "all")).toBe(200);
  });

  test("searchScope 'all' bumps to 600 (outside invite deck)", () => {
    expect(resolveMessageListPageSize("date", "all")).toBe(600);
  });

  test("default folder-scope non-invite is 300", () => {
    expect(resolveMessageListPageSize("date", "folder")).toBe(300);
  });
});

describe("buildMessageListQueryUrl — endpoint selection", () => {
  test("default → /messages", () => {
    const url = buildMessageListQueryUrl(baseOpts);
    expect(url).toMatch(/^\/api\/accounts\/acc-1\/messages\?/);
  });

  test("supportsThreads → /threads and threadDateSource is set", () => {
    const url = buildMessageListQueryUrl({
      ...baseOpts,
      supportsThreads: true,
      threadDateSource: "first"
    });
    expect(url).toMatch(/^\/api\/accounts\/acc-1\/threads\?/);
    const params = parseQuery(url);
    expect(params.threadDateSource).toBe("first");
  });

  test("query + no threads → /search with q", () => {
    const url = buildMessageListQueryUrl({
      ...baseOpts,
      query: "report draft"
    });
    expect(url).toMatch(/^\/api\/accounts\/acc-1\/search\?/);
    const params = parseQuery(url);
    expect(params.q).toBe("report draft");
    // fields are added only on search (not /related)
    expect(params.fields).toBe("subject,from");
  });

  test("query + threads → /threads with q and threadDateSource", () => {
    const url = buildMessageListQueryUrl({
      ...baseOpts,
      supportsThreads: true,
      query: "quarterly"
    });
    expect(url).toMatch(/^\/api\/accounts\/acc-1\/threads\?/);
    const params = parseQuery(url);
    expect(params.q).toBe("quarterly");
    expect(params.threadDateSource).toBe(baseOpts.threadDateSource);
    expect(params.fields).toBe("subject,from");
  });

  test("isRelatedSearch wins over everything and uses /related with relatedId", () => {
    const url = buildMessageListQueryUrl({
      ...baseOpts,
      supportsThreads: true,
      query: "ignored-because-related",
      isRelatedSearch: true,
      relatedQueryId: "rel-42"
    });
    expect(url).toMatch(/^\/api\/accounts\/acc-1\/related\?/);
    const params = parseQuery(url);
    expect(params.relatedId).toBe("rel-42");
    // In related mode, `fields` must NOT be sent (the check is guarded by !isRelatedSearch).
    expect(params.fields).toBeUndefined();
    // q is also not appended to related (the final threads-q branch is only for /threads).
    expect(params.q).toBeUndefined();
  });
});

describe("buildMessageListQueryUrl — pagination & scope params", () => {
  test("page + pageSize use the default 300 when groupBy!=invite-deck and scope=folder", () => {
    const url = buildMessageListQueryUrl({ ...baseOpts, page: 3 });
    const params = parseQuery(url);
    expect(params.page).toBe("3");
    expect(params.pageSize).toBe("300");
  });

  test("searchScope 'all' uses pageSize 600", () => {
    const url = buildMessageListQueryUrl({ ...baseOpts, searchScope: "all" });
    const params = parseQuery(url);
    expect(params.pageSize).toBe("600");
  });

  test("invite-deck groupBy forces pageSize 200", () => {
    const url = buildMessageListQueryUrl({
      ...baseOpts,
      groupBy: INVITE_DECK_GROUP_BY
    });
    const params = parseQuery(url);
    expect(params.pageSize).toBe("200");
    expect(params.groupBy).toBe(INVITE_DECK_GROUP_BY);
  });

  test("folder scope + activeFolderId → folderId is set", () => {
    const url = buildMessageListQueryUrl(baseOpts);
    const params = parseQuery(url);
    expect(params.folderId).toBe("folder-inbox");
    expect(params.excludeFolderIds).toBeUndefined();
  });

  test("folder scope with empty folderId does NOT set folderId", () => {
    const url = buildMessageListQueryUrl({ ...baseOpts, activeFolderId: "" });
    const params = parseQuery(url);
    expect(params.folderId).toBeUndefined();
  });

  test("all scope → folderId dropped, excludeFolderIds joined", () => {
    const url = buildMessageListQueryUrl({
      ...baseOpts,
      searchScope: "all",
      currentSearchExcludedFolderIds: ["folder-spam", "folder-trash"]
    });
    const params = parseQuery(url);
    expect(params.folderId).toBeUndefined();
    expect(params.excludeFolderIds).toBe("folder-spam,folder-trash");
  });

  test("related search + folder scope ignores folderId (not-related guard)", () => {
    const url = buildMessageListQueryUrl({
      ...baseOpts,
      isRelatedSearch: true,
      relatedQueryId: "rel-1"
    });
    const params = parseQuery(url);
    expect(params.folderId).toBeUndefined();
  });
});

describe("buildMessageListQueryUrl — search badges", () => {
  test("attachments badge → attachments=1", () => {
    const url = buildMessageListQueryUrl({
      ...baseOpts,
      searchBadges: { attachments: true }
    });
    const params = parseQuery(url);
    expect(params.attachments).toBe("1");
  });

  test("effectiveSearchBadges → badges param is comma-joined", () => {
    const url = buildMessageListQueryUrl({
      ...baseOpts,
      effectiveSearchBadges: ["unread", "flagged"]
    });
    const params = parseQuery(url);
    expect(params.badges).toBe("unread,flagged");
  });

  test("no badges → no attachments / no badges params", () => {
    const url = buildMessageListQueryUrl(baseOpts);
    const params = parseQuery(url);
    expect(params.attachments).toBeUndefined();
    expect(params.badges).toBeUndefined();
  });
});

describe("buildMessageListQueryUrl — query whitespace handling", () => {
  test("whitespace-only query is treated as empty (no /search, no q)", () => {
    const url = buildMessageListQueryUrl({ ...baseOpts, query: "   " });
    expect(url).toMatch(/^\/api\/accounts\/acc-1\/messages\?/);
    const params = parseQuery(url);
    expect(params.q).toBeUndefined();
    expect(params.fields).toBeUndefined();
  });

  test("query is trimmed before being set as q", () => {
    const url = buildMessageListQueryUrl({ ...baseOpts, query: "  quarterly report  " });
    const params = parseQuery(url);
    expect(params.q).toBe("quarterly report");
  });
});
