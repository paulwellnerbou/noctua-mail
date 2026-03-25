import type { CalendarInviteActionType } from "./calendarInviteProcessing";

export type CaldavConfig = {
  url: string;
  user: string;
  password: string;
  calendarPath?: string;
  syncIntervalMs?: number;
};

export type Account = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  ownerUserId?: string;
  settings?: AccountSettings;
  caldav?: CaldavConfig;
  imap: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
  };
};

export type AccountDateFormat = "locale" | "mdy" | "dmy" | "ymd";

export type AccountSettings = {
  sync?: {
    maxIdleSessions?: number;
    backgroundPollIntervalMs?: number;
    pollIntervalMs?: number;
  };
  threading?: {
    includeAcrossFolders?: boolean;
  };
  layout?: {
    defaultView?: "card" | "table" | "compact" | "threads";
  };
  appearance?: {
    dateFormat?: AccountDateFormat;
    topicColorRows?: boolean;
    senderIcons?: boolean;
  };
  calendar?: {
    weekStartsOn?: "monday" | "sunday";
  };
  signatures?: {
    id: string;
    name: string;
    body: string;
  }[];
  defaultSignatureId?: string;
};

export type MailboxState = {
  accountId: string;
  folderId: string;
  mailboxPath: string;
  uidValidity?: string | null;
  highestModSeq?: string | null;
  highestUid?: number | null;
  supportsQresync?: boolean | null;
};

export type Folder = {
  id: string;
  name: string;
  count: number;
  parentId?: string | null;
  accountId: string;
  specialUse?: string;
  flags?: string[];
  delimiter?: string;
  unreadCount?: number;
};

export type Message = {
  id: string;
  threadId: string;
  parentId?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  xForwardedMessageId?: string;
  xComposeFormat?: string;
  quotedHtmlEdited?: boolean;
  subject: string;
  from: string;
  fromEmail?: string;
  to: string;
  cc?: string;
  bcc?: string;
  preview: string;
  date: string;
  dateValue: number;
  folderId: string;
  accountId: string;
  mailboxPath?: string;
  imapUid?: number;
  body: string;
  htmlBody?: string;
  source?: string;
  hasSource?: boolean;
  hasAttachments?: boolean;
  hasInlineAttachments?: boolean;
  attachments?: Attachment[];
  unread?: boolean;
  priority?: string;
  flags?: string[];
  seen?: boolean;
  answered?: boolean;
  flagged?: boolean;
  deleted?: boolean;
  draft?: boolean;
  recent?: boolean;
  category?: string | null;
  categoryScore?: number | null;
  categorySignals?: string[];
  calendarEventUids?: string[];
  calendarInviteStates?: MessageCalendarInviteState[];
  listUnsubscribe?: string | null;
  listId?: string | null;
  groupKey?: string;
  threadSortDateValue?: number;
  topics?: Topic[];
  topicSuggestions?: Topic[];
};

export const TOPIC_COLORS = [
  "tomato", "red", "ruby", "crimson", "pink", "plum",
  "purple", "violet", "iris", "indigo", "blue", "sky",
  "cyan", "teal", "mint", "jade", "green", "grass", "lime",
  "yellow", "amber", "orange", "gold", "bronze", "brown",
  "sand", "slate", "mauve", "olive", "sage", "gray",
] as const;

export type TopicColor = (typeof TOPIC_COLORS)[number];

/** Returns the Radix scale name for use as a Badge color prop. */
export function topicColorToScale(color: string | null | undefined): TopicColor {
  if (!color) return "gray";
  return (TOPIC_COLORS as readonly string[]).includes(color) ? (color as TopicColor) : "gray";
}

/** Returns a CSS var reference for a topic color dot/indicator. */
export function topicColorToCssVar(color: string | null | undefined, shade = 9): string {
  if (!color) return `var(--gray-${shade})`;
  return `var(--${color}-${shade})`;
}

export type Topic = {
  id: string;
  accountId: string;
  name: string;
  color: TopicColor | null;
  imapKeyword: string;
  createdAt: number;
  updatedAt: number;
  suggestionScore?: number;
  matchCount?: number;
};

export type RecipientAlias = {
  id: string;
  accountId: string;
  name: string;
  recipients: string;
  normalizedRecipients: string;
  createdAt: number;
  updatedAt: number;
};

export type RecipientSuggestion =
  | {
      kind: "alias";
      id: string;
      name: string;
      label: string;
      insertValue: string;
      recipients: string;
    }
  | {
      kind: "recipient";
      label: string;
      insertValue: string;
    };

// Signals used to derive topic suggestions from past manual assignments.
// No manual rules table — the app learns from what the user has tagged before.
// See getTopicSuggestionsForThread() in lib/topics.ts.
export const TOPIC_SUGGESTION_SIGNALS = [
  "senderEmail",    // exact sender email address, e.g. "noreply@gitlab.com"
  "senderDomain",   // domain part of sender email, e.g. "gitlab.com"
  "recipient",      // email address appearing in To or CC
  "listId",         // List-Id header, e.g. "ndrde/code/unified-sophora/api"
  "jiraProjectKey", // JIRA issue key prefix from the subject, e.g. "UNSAPIX" from "UNSAPIX-311"
] as const;

export type TopicSuggestionSignal = (typeof TOPIC_SUGGESTION_SIGNALS)[number];

export type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  cid?: string;
  dataUrl?: string;
  url?: string;
};

export type CalendarReminder = {
  id: string;
  accountId: string;
  userId: string;
  messageId?: string;
  eventUid?: string;
  eventTitle: string;
  eventLocation?: string;
  eventDescription?: string;
  startTimezone?: string;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  eventStartAtMs: number;
  eventEndAtMs?: number;
  nextEventStartAtMs: number;
  leadMinutes: number;
  leadLabel: string;
  triggerAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CalendarEventSourceType = "local" | "caldav" | "email";
export type CalendarParticipationStatus =
  | "NEEDS-ACTION"
  | "ACCEPTED"
  | "DECLINED"
  | "TENTATIVE"
  | "DELEGATED";
export type CalendarParticipationScope = "series" | "occurrence";

export type CalendarEvent = {
  id: string;
  accountId: string;
  calendarId?: string;
  eventUid: string;
  summary: string;
  description?: string;
  location?: string;
  startAtMs: number;
  endAtMs?: number;
  allDay: boolean;
  startTimezone?: string;
  endTimezone?: string;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  status?: string;
  organizer?: string;
  attendees?: string;
  myPartstat?: CalendarParticipationStatus;
  myPartstatUpdatedAtMs?: number;
  myAttendeeEmail?: string;
  replyRequested?: boolean;
  remoteEtag?: string;
  remoteHref?: string;
  rawIcs?: string;
  sourceType: CalendarEventSourceType;
  messageId?: string;
  /** Per-occurrence message links for rescheduled occurrences. Key = occurrence startAtMs as string. */
  occurrenceMessageIds?: Record<string, string>;
  createdAtMs: number;
  updatedAtMs: number;
  deletedAtMs?: number;
};

export type MessageCalendarInviteState = {
  eventUid: string;
  actionType: CalendarInviteActionType;
  processedAtMs?: number;
  processedByUserId?: string;
  processedAutomatically?: boolean;
};

export type User = {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: number;
};

export type InviteCode = {
  code: string;
  role: "admin" | "user";
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
  usedByUserId?: string | null;
};
