import { describe, expect, test } from "bun:test";
import { formatAddress, formatAddressList, parseAddressList, splitAddressList } from "./parseAddressList";

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

  test("does not split on commas after escaped quotes inside quoted display names", () => {
    expect(splitAddressList(`"O\\"Connor, Anne" <anne@example.test>, bob@example.test`)).toEqual([
      `"O\\"Connor, Anne" <anne@example.test>`,
      "bob@example.test"
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

describe("formatAddress", () => {
  test("returns the bare address when there is no display name", () => {
    expect(formatAddress("", "jane@example.com")).toBe("jane@example.com");
    expect(formatAddress("   ", "jane@example.com")).toBe("jane@example.com");
  });

  test("combines display name and address", () => {
    expect(formatAddress("Jane Roe", "jane@example.com")).toBe("Jane Roe <jane@example.com>");
  });

  test("quotes display names containing RFC 5322 specials", () => {
    expect(formatAddress("Doe, John", "john@doe.com")).toBe(`"Doe, John" <john@doe.com>`);
    expect(formatAddress('Anne "Ann" O\\Connor', "anne@example.test")).toBe(
      `"Anne \\"Ann\\" O\\\\Connor" <anne@example.test>`
    );
  });
});

describe("formatAddressList", () => {
  test("formats every entry as name + address", () => {
    expect(formatAddressList(`"Doe, John" <john@doe.com>, Jane Roe <jane@example.com>`)).toBe(
      `"Doe, John" <john@doe.com>, Jane Roe <jane@example.com>`
    );
  });

  test("keeps bare addresses and unparsable entries as-is", () => {
    expect(formatAddressList("jane@example.com, undisclosed-recipients:;")).toBe(
      "jane@example.com, undisclosed-recipients:;"
    );
  });

  test("returns an empty string for blank input", () => {
    expect(formatAddressList("")).toBe("");
    expect(formatAddressList(null)).toBe("");
  });
});
