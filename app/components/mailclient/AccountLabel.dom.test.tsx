// Runs only under `bun run test:dom` (preloads happy-dom before component load).
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import AccountLabel from "./AccountLabel";

afterEach(cleanup);

function lines(container: HTMLElement) {
  return Array.from(container.querySelectorAll("span > span"), (line) => line.textContent);
}

describe("AccountLabel", () => {
  it("shows the email under the name", () => {
    const { container } = render(<AccountLabel name="Ada Example" email="ada@example.com" />);
    expect(lines(container)).toEqual(["Ada Example", "ada@example.com"]);
  });

  it("shows the email alone when there is no name", () => {
    const { container } = render(<AccountLabel name="" email="ada@example.com" />);
    expect(lines(container)).toEqual(["ada@example.com"]);
  });

  it("treats a whitespace-only name as missing", () => {
    const { container } = render(<AccountLabel name="   " email="ada@example.com" />);
    expect(lines(container)).toEqual(["ada@example.com"]);
  });

  it("shows the name alone when there is no email", () => {
    const { container } = render(<AccountLabel name="Ada Example" />);
    expect(lines(container)).toEqual(["Ada Example"]);
  });
});
