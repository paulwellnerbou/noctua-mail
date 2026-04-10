import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import { buildThreadTree, findThreadRootByMessageId } from "./threadTree";

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "m1",
    threadId: "t1",
    subject: "Subject",
    from: "alice@example.com",
    to: "bob@example.com",
    preview: "Preview",
    date: new Date(0).toISOString(),
    dateValue: 0,
    folderId: "acc:INBOX",
    accountId: "acc",
    body: "",
    ...overrides
  };
}

describe("findThreadRootByMessageId", () => {
  it("returns the root node for a nested reply", () => {
    const root = makeMessage({ id: "root" });
    const reply = makeMessage({ id: "reply", parentId: "root", dateValue: 1 });
    const nested = makeMessage({ id: "nested", parentId: "reply", dateValue: 2 });
    const forest = buildThreadTree([root, reply, nested]);

    const foundRoot = findThreadRootByMessageId(forest, "nested");

    expect(foundRoot?.message.id).toBe("root");
  });

  it("returns null when the message is not in the forest", () => {
    const root = makeMessage({ id: "root" });
    const forest = buildThreadTree([root]);

    expect(findThreadRootByMessageId(forest, "missing")).toBeNull();
  });
});
