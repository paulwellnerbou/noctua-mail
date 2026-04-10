import { describe, expect, it } from "bun:test";
import { getTopicDisplayName } from "./topicPresentation";

describe("getTopicDisplayName", () => {
  it("returns the short name when preferred and available", () => {
    expect(
      getTopicDisplayName(
        { name: "Ukulele-Stammtisch Frankfurt", shortName: "Uke FFM" },
        { preferShortName: true }
      )
    ).toBe("Uke FFM");
  });

  it("falls back to the full name when the short name is blank", () => {
    expect(
      getTopicDisplayName(
        { name: "Ukulele-Stammtisch Frankfurt", shortName: "   " },
        { preferShortName: true }
      )
    ).toBe("Ukulele-Stammtisch Frankfurt");
  });

  it("keeps the full name when short names are not preferred", () => {
    expect(
      getTopicDisplayName(
        { name: "Ukulele-Stammtisch Frankfurt", shortName: "Uke FFM" },
        { preferShortName: false }
      )
    ).toBe("Ukulele-Stammtisch Frankfurt");
  });
});
