import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Message, Topic } from "@/lib/data";
import TopicSuggestionPanel from "./TopicSuggestionPanel";

function makeTopic(): Topic {
  return {
    id: "topic-build",
    accountId: "acc-1",
    name: "Build Alerts",
    color: "blue",
    imapKeyword: "noctua-topic-build",
    createdAt: 1,
    updatedAt: 1
  };
}

function makeMessage(): Message {
  return {
    id: "msg-1",
    threadId: "thread-1",
    subject: "Build failed in main",
    from: "CI Bot <ci@example.com>",
    to: "Team <team@example.com>",
    preview: "Preview",
    date: new Date(Date.UTC(2026, 2, 18, 10, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 18, 10, 0, 0),
    folderId: "acc-1:INBOX",
    accountId: "acc-1",
    body: ""
  };
}

describe("TopicSuggestionPanel", () => {
  it("renders nothing without a topic", () => {
    const markup = renderToStaticMarkup(
      <TopicSuggestionPanel
        topic={null}
        suggestions={[]}
        onOpenSuggestion={() => {}}
        onAddSuggestion={() => {}}
      />
    );

    expect(markup).toBe("");
  });

  it("renders a loading state for an active topic fetch", () => {
    const markup = renderToStaticMarkup(
      <TopicSuggestionPanel
        topic={makeTopic()}
        suggestions={[]}
        isLoading
        onOpenSuggestion={() => {}}
        onAddSuggestion={() => {}}
      />
    );

    expect(markup).toContain("Suggested for");
    expect(markup).toContain("Finding matches");
  });

  it("renders suggestion rows when matches are available", () => {
    const markup = renderToStaticMarkup(
      <TopicSuggestionPanel
        topic={makeTopic()}
        suggestions={[{ message: makeMessage(), suggestionScore: 8 }]}
        onOpenSuggestion={() => {}}
        onAddSuggestion={() => {}}
      />
    );

    expect(markup).toContain("Build failed in main");
    expect(markup).toContain("Score 8");
    expect(markup).toContain("Add");
  });
});
