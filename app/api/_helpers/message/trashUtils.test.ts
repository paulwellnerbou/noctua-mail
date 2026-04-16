import { describe, expect, it } from "bun:test";
import { resolveMessageTrashState } from "./trashUtils";

describe("resolveMessageTrashState", () => {
  it("marks message as in trash when folder id matches trash folder id", () => {
    const state = resolveMessageTrashState(
      { folderId: "acc-1:Trash", mailboxPath: "INBOX" },
      { id: "acc-1:Trash", delimiter: "/" },
      "acc-1"
    );
    expect(state.isInTrash).toBe(true);
    expect(state.trashMailbox).toBe("Trash");
  });

  it("marks message as in trash when mailbox path equals trash mailbox", () => {
    const state = resolveMessageTrashState(
      { folderId: "acc-1:INBOX", mailboxPath: "Trash" },
      { id: "acc-1:Trash", delimiter: "/" },
      "acc-1"
    );
    expect(state.isInTrash).toBe(true);
  });

  it("marks message as in trash when mailbox path is a trash subfolder", () => {
    const state = resolveMessageTrashState(
      { folderId: "acc-1:Other", mailboxPath: "Trash/Subfolder" },
      { id: "acc-1:Trash", delimiter: "/" },
      "acc-1"
    );
    expect(state.isInTrash).toBe(true);
  });

  it("uses the folder delimiter for subfolder checks", () => {
    const state = resolveMessageTrashState(
      { folderId: "acc-1:Other", mailboxPath: "Trash.Subfolder" },
      { id: "acc-1:Trash", delimiter: "." },
      "acc-1"
    );
    expect(state.isInTrash).toBe(true);
  });

  it("falls back to folder-id-derived mailbox path when mailboxPath is missing", () => {
    const state = resolveMessageTrashState(
      { folderId: "acc-1:INBOX", mailboxPath: "" },
      { id: "acc-1:Trash", delimiter: "/" },
      "acc-1"
    );
    expect(state.currentMailbox).toBe("INBOX");
    expect(state.isInTrash).toBe(false);
  });
});
