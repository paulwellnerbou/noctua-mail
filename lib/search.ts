import MiniSearch from "minisearch";
import type { Message } from "./data";

export function buildSearchIndex(messages: Message[]) {
  const miniSearch = new MiniSearch({
    fields: ["subject", "from", "to", "body"],
    storeFields: [
      "id",
      "threadId",
      "subject",
      "from",
      "to",
      "messageId",
      "inReplyTo",
      "preview",
      "date",
      "dateValue",
      "folderId",
      "htmlBody",
      "body",
      "attachments",
      "unread"
    ],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2
    }
  });

  miniSearch.addAll(messages);
  return miniSearch;
}

export function searchMessages(index: MiniSearch, query: string) {
  if (!query.trim()) {
    return [];
  }

  return index.search(query);
}
