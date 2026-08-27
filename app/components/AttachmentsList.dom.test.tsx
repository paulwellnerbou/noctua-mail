// Runs only under `bun run test:dom` (preloads happy-dom before component load).
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { Attachment } from "@/lib/data";
import AttachmentsList from "./AttachmentsList";

afterEach(cleanup);

const pdf: Attachment = {
  id: "att-a-1-0",
  filename: "report.pdf",
  contentType: "application/pdf",
  size: 5_499_904, // 5.5 MB in decimal units
  inline: false,
  url: "/api/accounts/a/messages/m/attachments/att-a-1-0"
};

const inlineImage: Attachment = {
  id: "att-a-1-1",
  filename: "sig.png",
  contentType: "image/png",
  size: 3072,
  inline: true,
  url: "/api/accounts/a/messages/m/attachments/att-a-1-1"
};

// htmlBody must be non-empty for an inline image to count as body-rendered
// (and thus hidden from the main list / eligible for the removal section).
const htmlBody = "<p>hi</p>";

describe("AttachmentsList", () => {
  it("renders attachment sizes in human-readable form", () => {
    const { getByText } = render(<AttachmentsList attachments={[pdf]} htmlBody={htmlBody} />);
    expect(getByText(/report\.pdf/)).toBeTruthy();
    expect(getByText(/5\.5 MB/)).toBeTruthy();
  });

  it("omits the 'Images in message' section when removal is disabled", () => {
    const { queryByText } = render(
      <AttachmentsList attachments={[pdf, inlineImage]} htmlBody={htmlBody} />
    );
    // Inline image is hidden from the main list and there is no removal section.
    expect(queryByText("Images in message")).toBeNull();
    expect(queryByText(/sig\.png/)).toBeNull();
  });

  it("shows inline images as a removable section only when onRemove is provided", () => {
    const { getByText, getByLabelText } = render(
      <AttachmentsList attachments={[pdf, inlineImage]} htmlBody={htmlBody} onRemove={() => {}} />
    );
    expect(getByText("Images in message")).toBeTruthy();
    expect(getByText(/sig\.png/)).toBeTruthy();
    // Remove control distinguishes image vs attachment and names the file.
    expect(getByLabelText("Remove image: sig.png")).toBeTruthy();
    expect(getByLabelText("Remove attachment: report.pdf")).toBeTruthy();
  });
});
