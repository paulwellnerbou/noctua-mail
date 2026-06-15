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
      messageId: "msg-1",
      eventStartAtMs: eventSnapshot.startAtMs,
      eventEndAtMs: eventSnapshot.endAtMs,
      showEmailSnapshot,
      onOpenMessage: () => undefined
    })
  );
}

function renderWithEdit(sourceType: CalendarEvent["sourceType"]): string {
  const eventSnapshot = buildEventSnapshot({ sourceType });
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
      onEditEvent: () => undefined
    })
  );
}

describe("EventDetailView", () => {
  it("renders the saved email snapshot by default", () => {
    const html = render();
    expect(html).toContain("Original Email");
    expect(html).toContain("Invite: Kickoff");
    expect(html).toContain("Open Email");
  });

  it("can suppress the saved email snapshot when embedded in the source mail view", () => {
    const html = render(false);
    expect(html).not.toContain("Original Email");
    expect(html).not.toContain("Invite: Kickoff");
  });

  it("offers an Edit button for local (custom / ICS-imported) events", () => {
    expect(renderWithEdit("local")).toContain("Edit");
  });

  it("does not offer an Edit button for received email invites", () => {
    expect(renderWithEdit("email")).not.toContain("Edit");
  });
});
