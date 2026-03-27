import { describe, expect, it } from "bun:test";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import {
  COMPOSE_INVITE_HEADER,
  decodeComposeInviteHeader,
  encodeComposeInviteHeader,
  extractComposeInviteDraftFromSource
} from "./composeInviteMetadata";

const invite: ComposeInviteDraft = {
  location: "Room 2",
  start: "2026-03-26T13:00",
  end: "2026-03-26T14:00",
  allDay: false,
  recurrenceRule: "FREQ=WEEKLY"
};

describe("composeInviteMetadata", () => {
  it("round-trips encoded invite headers", () => {
    const encoded = encodeComposeInviteHeader(invite);
    expect(decodeComposeInviteHeader(encoded)).toEqual(invite);
  });

  it("extracts the invite header from raw message source", () => {
    const encoded = encodeComposeInviteHeader(invite);
    const source = [
      `From: Owner <owner@example.test>`,
      `Subject: Draft`,
      `${COMPOSE_INVITE_HEADER}: ${encoded}`,
      ``,
      `Body`
    ].join("\r\n");
    expect(extractComposeInviteDraftFromSource(source)).toEqual(invite);
  });

  it("returns null for invalid encoded header values", () => {
    const source = [
      `From: Owner <owner@example.test>`,
      `${COMPOSE_INVITE_HEADER}: definitely-not-base64`,
      ``,
      `Body`
    ].join("\r\n");
    expect(extractComposeInviteDraftFromSource(source)).toBeNull();
  });
});
