import { describe, expect, test } from "bun:test";
import {
  getRecipientInputToken,
  normalizeRecipientListForComparison,
  replaceLastRecipientToken,
  splitRecipientEntries
} from "./recipientLists";

describe("recipient list helpers", () => {
  test("splits recipient entries while preserving quoted commas", () => {
    expect(
      splitRecipientEntries(
        '"Example, Nadine" <nadine@example.test>, Bob <bob@example.test>; carol@example.test'
      )
    ).toEqual([
      '"Example, Nadine" <nadine@example.test>',
      "Bob <bob@example.test>",
      "carol@example.test"
    ]);
  });

  test("normalizes separators, whitespace, and case for alias comparison", () => {
    expect(
      normalizeRecipientListForComparison(
        '  Alice <ALICE@example.test> ;  Bob <bob@example.test>,   carol@example.test  '
      )
    ).toBe("alice <alice@example.test>, bob <bob@example.test>, carol@example.test");
  });

  test("returns the current compose token from the last recipient position", () => {
    expect(getRecipientInputToken("Alice <alice@example.test>, bo")).toBe("bo");
    expect(getRecipientInputToken("Alice <alice@example.test>, ")).toBe("");
  });

  test("replaces the last compose token with the selected recipient string", () => {
    expect(
      replaceLastRecipientToken(
        'Alice <alice@example.test>, "Example, Nadine" <nadine@example.test>',
        "Bob <bob@example.test>"
      )
    ).toBe("Alice <alice@example.test>, Bob <bob@example.test>, ");
  });

  test("appends a selected recipient after a trailing separator", () => {
    expect(
      replaceLastRecipientToken(
        "Alice <alice@example.test>, ",
        "Carol <carol@example.test>"
      )
    ).toBe("Alice <alice@example.test>, Carol <carol@example.test>, ");
  });
});
