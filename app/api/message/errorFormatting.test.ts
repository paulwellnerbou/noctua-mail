import { describe, expect, it } from "bun:test";
import { appendMessageIdToError } from "./errorFormatting";

describe("appendMessageIdToError", () => {
  it("appends the message ID to message-scoped errors", () => {
    expect(appendMessageIdToError("Message not found", "msg_123")).toBe(
      "[messageId: msg_123] Message not found"
    );
  });

  it("returns the original message when no message ID is available", () => {
    expect(appendMessageIdToError("Message not found", "")).toBe("Message not found");
  });

  it("does not append the message ID twice", () => {
    expect(appendMessageIdToError("[messageId: msg_123] Message not found", "msg_123")).toBe(
      "[messageId: msg_123] Message not found"
    );
  });
});
