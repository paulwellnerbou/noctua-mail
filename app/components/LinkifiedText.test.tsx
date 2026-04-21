import { describe, expect, it } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { linkifyText } from "./LinkifiedText";

function findAnchor(nodes: ReactNode[]) {
  return nodes.find((node) => isValidElement(node) && node.type === "a");
}

describe("linkifyText", () => {
  it("linkifies plain http urls", () => {
    const nodes = linkifyText("Open https://example.com/test");
    const anchor = findAnchor(nodes);

    expect(anchor && isValidElement(anchor) ? anchor.props.href : undefined).toBe(
      "https://example.com/test"
    );
  });

  it("joins newline-split urls used in calendar descriptions", () => {
    const nodes = linkifyText(
      [
        "Join Microsoft Teams Meeting",
        "https://teams.microsoft.com/l/meetup-",
        "join/19%3ameeting_YTgxNDMyMDAtMzc4ZS00YTYyLWFmOTgtNmlzMTZmNWVhZTVj%40thread.v2/0?",
        "context=%7b%22Tid%22%3a%220d3556e8-200e-4613-bd00-e12ab9775303%22%7d (ID: 1234)"
      ].join("\n")
    );
    const anchor = findAnchor(nodes);
    const href = anchor && isValidElement(anchor) ? anchor.props.href : undefined;

    expect(href).toBe(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_YTgxNDMyMDAtMzc4ZS00YTYyLWFmOTgtNmlzMTZmNWVhZTVj%40thread.v2/0?context=%7b%22Tid%22%3a%220d3556e8-200e-4613-bd00-e12ab9775303%22%7d"
    );
  });

  it("does not absorb the next line of prose into a link", () => {
    const nodes = linkifyText("https://meet.google.com/err-sosa-trk\nOr");
    const anchor = findAnchor(nodes);

    expect(anchor && isValidElement(anchor) ? anchor.props.href : undefined).toBe(
      "https://meet.google.com/err-sosa-trk"
    );
  });
});
