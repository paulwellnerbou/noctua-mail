import { describe, expect, it } from "bun:test";
import { splitTextWithUrls } from "./linkify";

function getUrls(text: string) {
  return splitTextWithUrls(text)
    .filter((segment): segment is { type: "url"; value: string } => segment.type === "url")
    .map((segment) => segment.value);
}

describe("splitTextWithUrls", () => {
  it("joins urls split across a single line break", () => {
    expect(
      getUrls(
        [
          "Join Microsoft Teams Meeting",
          "https://teams.microsoft.com/l/meetup-",
          "join/19%3ameeting_demo%40thread.v2/0?context=%7b%22Tid%22%3a%22tenant%22%7d"
        ].join("\n")
      )
    ).toEqual([
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo%40thread.v2/0?context=%7b%22Tid%22%3a%22tenant%22%7d"
    ]);
  });

  it("treats blank lines after urls as separators", () => {
    const text =
      "Learn more about Meet at: https://support.google.com/a/users/answer/9282720\n\nPlease do not edit this section.";

    expect(getUrls(text)).toEqual(["https://support.google.com/a/users/answer/9282720"]);
    expect(splitTextWithUrls(text)).toContainEqual({
      type: "text",
      value: "\n\nPlease do not edit this section."
    });
  });

  it("does not absorb following prose after a single line break", () => {
    const text = "https://meet.google.com/err-sosa-trk\nOr join by phone";

    expect(getUrls(text)).toEqual(["https://meet.google.com/err-sosa-trk"]);
    expect(splitTextWithUrls(text)).toContainEqual({
      type: "text",
      value: "\nOr join by phone"
    });
  });
});
