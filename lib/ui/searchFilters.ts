export const SEARCH_FIELD_OPTIONS = [
  ["sender", "Sender"],
  ["participants", "Participants"],
  ["subject", "Subject"],
  ["body", "Body"],
  ["attachments", "Attachment names"]
] as const;

export const SEARCH_BADGE_OPTIONS = [
  ["unread", "Unread"],
  ["unanswered", "Unanswered"],
  ["flagged", "Flagged"],
  ["todo", "To-Do"],
  ["calendar", "Calendar"],
  ["attachments", "Attachments"],
  ["newsletter", "📰 Newsletters"],
  ["notification", "🔔 Notifications"],
  ["transactional", "🧾 Transactional"],
  ["ai-modified", "AI Modified"]
] as const;

type SearchFieldKey = (typeof SEARCH_FIELD_OPTIONS)[number][0];
type SearchBadgeKey = (typeof SEARCH_BADGE_OPTIONS)[number][0];

const searchFieldLabelMap = new Map<SearchFieldKey, string>(SEARCH_FIELD_OPTIONS);
const searchBadgeLabelMap = new Map<SearchBadgeKey, string>(SEARCH_BADGE_OPTIONS);

export const SEARCH_FIELD_ORDER = SEARCH_FIELD_OPTIONS.map(([key]) => key) as SearchFieldKey[];
export const SEARCH_BADGE_ORDER = SEARCH_BADGE_OPTIONS.map(([key]) => key) as SearchBadgeKey[];

export function getSearchFieldLabel(key: string): string {
  return searchFieldLabelMap.get(key as SearchFieldKey) ?? key;
}

export function getSearchBadgeLabel(key: string): string {
  return searchBadgeLabelMap.get(key as SearchBadgeKey) ?? key;
}
