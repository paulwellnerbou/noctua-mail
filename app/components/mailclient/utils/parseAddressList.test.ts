import { describe, expect, test } from "bun:test";
import { parseAddressList, splitAddressList } from "./parseAddressList";

describe("splitAddressList", () => {
  test("returns empty array for blank input", () => {
    expect(splitAddressList("")).toEqual([]);
    expect(splitAddressList(null)).toEqual([]);
    expect(splitAddressList(undefined)).toEqual([]);
  });

  test("splits a simple comma-separated list", () => {
    expect(splitAddressList("a@x.com, b@y.com")).toEqual(["a@x.com", "b@y.com"]);
  });

  test("does not split on commas inside quoted display names", () => {
    expect(splitAddressList(`"Doe, John" <john@doe.com>, jane@example.com`)).toEqual([
      `"Doe, John" <john@doe.com>`,
      "jane@example.com"
    ]);
  });

  test("preserves angle-bracketed addresses", () => {
    expect(splitAddressList("Alice <a@x.com>, Bob <b@y.com>")).toEqual([
      "Alice <a@x.com>",
      "Bob <b@y.com>"
    ]);
  });
});

describe("parseAddressList", () => {
  test("extracts displayName and email from each entry", () => {
    expect(parseAddressList(`"Doe, John" <john@doe.com>, jane@example.com`)).toEqual([
      { raw: `"Doe, John" <john@doe.com>`, displayName: "Doe, John", email: "john@doe.com" },
      { raw: "jane@example.com", displayName: "", email: "jane@example.com" }
    ]);
  });
});
