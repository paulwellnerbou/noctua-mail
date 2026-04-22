import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarEvent } from "@/lib/data";
import EventDetailView from "./EventDetailView";

function buildEventSnapshot(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    accountId: "acc-1",
    eventUid: "event-1@example.test",
    summary: "Kickoff",
    startAtMs: Date.UTC(2026, 3, 22, 9, 0, 0),
    endAtMs: Date.UTC(2026, 3, 22, 10, 0, 0),
    allDay: false,
    sourceType: "email",
    createdAtMs: Date.UTC(2026, 3, 20, 12, 0, 0),
    updatedAtMs: Date.UTC(2026, 3, 20, 12, 0, 0),
    sourceSubject: "Invite: Kickoff",
    sourceFromAddr: "organizer@example.test",
    sourceBodyText: "Agenda",
    ...overrides
  };
}

function render(showEmailSnapshot?: boolean): string {
  const eventSnapshot = buildEventSnapshot();
  return renderToStaticMarkup(
    createElement(EventDetailView, {
      accountId: eventSnapshot.accountId,
      eventUid: eventSnapshot.eventUid,
      title: eventSnapshot.summary,
      startMs: eventSnapshot.startAtMs,
      endMs: eventSnapshot.endAtMs,
      allDay: eventSnapshot.allDay,
      sourceType: eventSnapshot.sourceType,
      eventId: eventSnapshot.id,
      eventSnapshot,
      eventStartAtMs: eventSnapshot.startAtMs,
      eventEndAtMs: eventSnapshot.endAtMs,
      showEmailSnapshot
    })
  );
}

describe("EventDetailView", () => {
  it("renders the saved email snapshot by default", () => {
    const html = render();
    expect(html).toContain("Original email");
    expect(html).toContain("Invite: Kickoff");
  });

  it("can suppress the saved email snapshot when embedded in the source mail view", () => {
    const html = render(false);
    expect(html).not.toContain("Original email");
    expect(html).not.toContain("Invite: Kickoff");
  });
});
