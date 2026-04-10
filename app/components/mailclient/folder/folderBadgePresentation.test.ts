import { describe, expect, it } from "bun:test";
import { getFolderBadgeKind, getFolderBadgeLabel } from "./folderBadgePresentation";

describe("folder badge presentation", () => {
  it("renders special folders as icon-only badges", () => {
    const sentFolder = { name: "Sent", specialUse: "\\Sent" };
    const inboxFolder = { name: "INBOX", specialUse: "" };

    expect(getFolderBadgeKind(sentFolder)).toBe("sent");
    expect(getFolderBadgeLabel(sentFolder, sentFolder.name)).toBe("");
    expect(getFolderBadgeKind(inboxFolder)).toBe("inbox");
    expect(getFolderBadgeLabel(inboxFolder, inboxFolder.name)).toBe("");
  });

  it("keeps regular folder names as text labels", () => {
    const folder = { name: "Ukulelen-Stammtisch FFM", specialUse: "" };

    expect(getFolderBadgeKind(folder)).toBe("folder");
    expect(getFolderBadgeLabel(folder, folder.name)).toBe("Ukulelen-Stammtisch FFM");
  });
});
