// Runs only under `bun run test:dom` (preloads happy-dom before component load).
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { buildAccountDestinationFoldersPath } from "@/lib/accountApiPaths";
import CopyToAccountDialog, { type CopyToAccountTarget } from "./CopyToAccountDialog";

const ada: CopyToAccountTarget = { id: "acc-ada", name: "Ada Example", email: "ada@example.com" };
const bea: CopyToAccountTarget = { id: "acc-bea", name: "Bea Example", email: "bea@example.com" };

let requestedPaths: string[] = [];
const apiFetch = async (input: RequestInfo | URL) => {
  requestedPaths.push(String(input));
  return Response.json([]);
};

afterEach(() => {
  cleanup();
  requestedPaths = [];
});

function dialog(accounts: CopyToAccountTarget[], open = true) {
  return (
    <Theme>
      <CopyToAccountDialog
        open={open}
        mode="move"
        messageCount={1}
        accounts={accounts}
        apiFetch={apiFetch}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />
    </Theme>
  );
}

function accountRow(account: CopyToAccountTarget) {
  const row = screen.getByText(account.email).closest("button");
  if (!row) throw new Error(`No row for ${account.email}`);
  return row;
}

function isSelected(account: CopyToAccountTarget) {
  return accountRow(account).getAttribute("aria-pressed") === "true";
}

const foldersLoaded = () => screen.findByText("No folders available.");

describe("CopyToAccountDialog account selection", () => {
  it("keeps the picked account when the account list is replaced", async () => {
    const { rerender } = render(dialog([ada, bea]));
    await foldersLoaded();
    fireEvent.click(accountRow(bea));
    await foldersLoaded();

    rerender(dialog([{ ...ada }, { ...bea }]));
    await foldersLoaded();

    expect(isSelected(bea)).toBe(true);
    expect(isSelected(ada)).toBe(false);
    expect(requestedPaths.at(-1)).toBe(buildAccountDestinationFoldersPath(bea.id));
  });

  it("falls back to the first account when the picked one is no longer offered", async () => {
    const { rerender } = render(dialog([ada, bea]));
    await foldersLoaded();
    fireEvent.click(accountRow(bea));
    await foldersLoaded();

    rerender(dialog([ada]));
    await foldersLoaded();

    expect(isSelected(ada)).toBe(true);
    expect(requestedPaths.at(-1)).toBe(buildAccountDestinationFoldersPath(ada.id));
  });

  it("starts from the first account each time it opens", async () => {
    const { rerender } = render(dialog([ada, bea]));
    await foldersLoaded();
    fireEvent.click(accountRow(bea));
    await foldersLoaded();

    rerender(dialog([ada, bea], false));
    rerender(dialog([ada, bea]));
    await foldersLoaded();

    expect(isSelected(ada)).toBe(true);
  });
});
