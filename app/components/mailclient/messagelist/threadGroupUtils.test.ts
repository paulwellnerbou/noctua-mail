import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import { buildThreadTree, flattenThread, getThreadLatestDate } from "./threadTree";
import {
  buildThreadGroupEntries,
  getCollapsedThreadFromDisplay,
  getCollapsedThreadIconParticipant,
  getMessageFromDisplay
} from "./threadGroupUtils";

function makeMessage(
  id: string,
  threadId: string,
  dateValue: number,
  overrides?: Partial<Message>
): Message {
  return {
    id,
    threadId,
    subject: `Subject ${id}`,
    from: "Alice <alice@example.com>",
    to: "Bob <bob@example.com>",
    preview: `Preview ${id}`,
    date: new Date(dateValue).toISOString(),
    dateValue,
    folderId: "acc-1:INBOX",
    accountId: "acc-1",
    body: "",
    ...overrides
  };
}

describe("buildThreadGroupEntries", () => {
  it("sorts thread groups by threadSortDateValue when present", () => {
    const olderByReceivedButNewerByActivity = [
      makeMessage("a1", "thread-a", 100, { threadSortDateValue: 100 }),
      makeMessage("a2", "thread-a", 200, { threadSortDateValue: 100, parentId: "a1" })
    ];
    const newerByReceived = [
      makeMessage("b1", "thread-b", 120, { threadSortDateValue: 150 }),
      makeMessage("b2", "thread-b", 150, { threadSortDateValue: 150, parentId: "b1" })
    ];
    const group = {
      key: "Today",
      label: "Today",
      items: [...olderByReceivedButNewerByActivity, ...newerByReceived]
    };

    const entries = buildThreadGroupEntries({
      group,
      collapsedThreads: {},
      includeThreadAcrossFolders: false,
      searchScope: "folder",
      activeFolderId: "acc-1:INBOX",
      buildThreadTree,
      flattenThread,
      getThreadLatestDate
    });

    expect(entries[0]?.threadGroupId).toBe("thread-b");
    expect(entries[1]?.threadGroupId).toBe("thread-a");
  });
});

describe("getCollapsedThreadIconParticipant", () => {
  it("prefers a non-user sender over the account sender in collapsed threads", () => {
    const fullFlat = [
      {
        message: makeMessage("m1", "thread-a", 100, {
          from: "Me <me@example.com>",
          fromEmail: "me@example.com",
          to: "Bob <bob@example.com>"
        }),
        depth: 0
      },
      {
        message: makeMessage("m2", "thread-a", 200, {
          from: "Bob <bob@example.com>",
          fromEmail: "bob@example.com",
          to: "Me <me@example.com>"
        }),
        depth: 1
      }
    ];

    expect(getCollapsedThreadIconParticipant(fullFlat, "me@example.com")).toEqual({
      from: "Bob <bob@example.com>",
      fromEmail: "bob@example.com"
    });
  });

  it("falls back to the first non-user recipient when the thread only contains sent messages", () => {
    const fullFlat = [
      {
        message: makeMessage("m1", "thread-a", 100, {
          from: "Me <me@example.com>",
          fromEmail: "me@example.com",
          to: "Bob <bob@example.com>, Me <me@example.com>",
          cc: "Carol <carol@example.com>"
        }),
        depth: 0
      }
    ];

    expect(getCollapsedThreadIconParticipant(fullFlat, "me@example.com")).toEqual({
      from: "Bob <bob@example.com>",
      fromEmail: "bob@example.com"
    });
  });
});

describe("recipient alias display", () => {
  const findRecipientAlias = (value?: string | null) => {
    if (value?.trim() === "Bob <bob@example.com>, Carol <carol@example.com>") {
      return {
        id: "alias-1",
        accountId: "acc-1",
        name: "Friday Group",
        recipients: value,
        normalizedRecipients: value.toLowerCase(),
        createdAt: 1,
        updatedAt: 1
      };
    }
    return null;
  };

  it("shows the alias name for sent-message recipient rows when one recipient field matches", () => {
    const result = getMessageFromDisplay(
      "Me <me@example.com>",
      { to: "Bob <bob@example.com>, Carol <carol@example.com>" },
      "me@example.com",
      true,
      false,
      findRecipientAlias
    );

    expect(result.text).toBe("Friday Group");
    expect(result.tooltip).toBe("Bob <bob@example.com>, Carol <carol@example.com>");
  });

  it("keeps the expanded recipient text when multiple recipient fields are populated", () => {
    const result = getMessageFromDisplay(
      "Me <me@example.com>",
      {
        to: "Bob <bob@example.com>, Carol <carol@example.com>",
        cc: "Dave <dave@example.com>"
      },
      "me@example.com",
      true,
      false,
      findRecipientAlias
    );

    expect(result.text).toBe("Bob, Carol, Dave");
  });

  it("uses alias names in collapsed recipient display when a thread message matches", () => {
    const fullFlat = [
      {
        message: makeMessage("m1", "thread-a", 100, {
          from: "Me <me@example.com>",
          fromEmail: "me@example.com",
          to: "Bob <bob@example.com>, Carol <carol@example.com>"
        }),
        depth: 0
      }
    ];

    const result = getCollapsedThreadFromDisplay(fullFlat, "me@example.com", true, findRecipientAlias);

    expect(result.text).toBe("Friday Group");
    expect(result.tooltip).toBe("Bob <bob@example.com>, Carol <carol@example.com>");
  });

  it("adds sent-message recipients to collapsed thread participants", () => {
    const fullFlat = [
      {
        message: makeMessage("m1", "thread-a", 100, {
          from: "Me <me@example.com>",
          fromEmail: "me@example.com",
          to: "Bob <bob@example.com>, Carol <carol@example.com>"
        }),
        depth: 0
      },
      {
        message: makeMessage("m2", "thread-a", 200, {
          from: "Petra <petra@example.com>",
          fromEmail: "petra@example.com",
          to: "Me <me@example.com>"
        }),
        depth: 1
      }
    ];

    const result = getCollapsedThreadFromDisplay(fullFlat, "me@example.com", false, findRecipientAlias);

    expect(result.text).toBe("Me, Friday Group, Petra");
    expect(result.tooltip).toBe(
      "Me <me@example.com>, Bob <bob@example.com>, Carol <carol@example.com>, Petra <petra@example.com>"
    );
  });

  it("dedupes collapsed sent-message recipients against later senders when no alias exists", () => {
    const fullFlat = [
      {
        message: makeMessage("m1", "thread-a", 100, {
          from: "Me <me@example.com>",
          fromEmail: "me@example.com",
          to: "Bob <bob@example.com>, Carol <carol@example.com>"
        }),
        depth: 0
      },
      {
        message: makeMessage("m2", "thread-a", 200, {
          from: "Bob <bob@example.com>",
          fromEmail: "bob@example.com",
          to: "Me <me@example.com>"
        }),
        depth: 1
      }
    ];

    const result = getCollapsedThreadFromDisplay(fullFlat, "me@example.com");

    expect(result.text).toBe("Me, Bob, Carol");
  });
});
