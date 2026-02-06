import type { Message } from "@/lib/data";

type MessageGroup = {
  key: string;
  label?: string;
  items: Message[];
  count?: number;
};

type ThreadNode = { message: Message; children: ThreadNode[]; threadSize: number };

export type FromDisplayInfo = {
  text: string;
  tooltip: string;
  isFromUser?: boolean;
  showRecipientIcon?: boolean;
};

type RecipientFields = {
  to?: string;
  cc?: string;
  bcc?: string;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const normalizeFromValue = (value: string) => value.replace(/\s+/g, " ").trim();

const stripWrappingQuotes = (value: string) => {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
};

const extractDisplayName = (value: string) => {
  const normalized = normalizeFromValue(value);
  if (!normalized) return "";
  const ltIndex = normalized.lastIndexOf("<");
  if (ltIndex <= 0 || !normalized.endsWith(">")) return "";
  const rawName = normalizeFromValue(normalized.slice(0, ltIndex));
  if (!rawName) return "";
  return stripWrappingQuotes(rawName);
};

const extractPrimaryEmail = (value: string) => {
  const normalized = normalizeFromValue(value);
  if (!normalized) return null;
  const angleMatch = normalized.match(/<\s*([^>]+)\s*>/);
  if (angleMatch?.[1]) return angleMatch[1].trim().toLowerCase();
  const directMatch = normalized.match(EMAIL_PATTERN);
  return directMatch?.[0]?.toLowerCase() ?? null;
};

const isMessageFromUser = (fromValue: string, userEmail?: string): boolean => {
  if (!userEmail) return false;
  const messageEmail = extractPrimaryEmail(fromValue);
  const normalizedUserEmail = userEmail.trim().toLowerCase();
  return messageEmail === normalizedUserEmail;
};

const splitRecipients = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const recipientDisplayValue = (recipient: string) => {
  const displayName = extractDisplayName(recipient);
  if (displayName) return displayName;
  const email = extractPrimaryEmail(recipient);
  return email || recipient;
};

const extractRecipientsDisplay = (fields?: RecipientFields): string => {
  if (!fields) return "";
  const seen = new Set<string>();
  const displayValues: string[] = [];
  [fields.to, fields.cc, fields.bcc].forEach((value) => {
    splitRecipients(value).forEach((recipient) => {
      const display = recipientDisplayValue(recipient);
      const key = extractPrimaryEmail(recipient) ?? display.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      displayValues.push(display);
    });
  });
  return displayValues.join(", ");
};

const recipientTooltip = (fields?: RecipientFields): string => {
  if (!fields) return "";
  return [fields.to, fields.cc, fields.bcc]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");
};

export function getMessageFromDisplay(
  fromValue: string,
  recipients?: RecipientFields,
  userEmail?: string,
  isInExpandedThread?: boolean,
  forceRecipientDisplay?: boolean
): FromDisplayInfo {
  const normalized = normalizeFromValue(fromValue);
  if (!normalized && !forceRecipientDisplay) return { text: "", tooltip: "" };

  const isFromUser = normalized ? isMessageFromUser(normalized, userEmail) : false;

  if (forceRecipientDisplay) {
    const recipientsDisplay = extractRecipientsDisplay(recipients);
    return {
      text: recipientsDisplay || "(no recipients)",
      tooltip: recipientTooltip(recipients),
      isFromUser,
      showRecipientIcon: true
    };
  }

  if (!normalized) return { text: "", tooltip: "" };

  // For single messages or messages in expanded threads: show "To: ..." if from user
  // isInExpandedThread = false means it's a collapsed thread header (show "Me")
  // isInExpandedThread = true means it's an expanded thread or single message (show "To: ...")
  if (isFromUser && isInExpandedThread && recipients) {
    const recipientsDisplay = extractRecipientsDisplay(recipients);
    return {
      text: recipientsDisplay || "(no recipients)",
      tooltip: recipientTooltip(recipients),
      isFromUser: true,
      showRecipientIcon: true
    };
  }

  const displayName = extractDisplayName(normalized);
  const displayText = isFromUser ? "Me" : (displayName || normalized);

  return {
    text: displayText,
    tooltip: normalized,
    isFromUser,
    showRecipientIcon: false
  };
}

export function getCollapsedThreadFromDisplay(
  fullFlat: Array<{ message: Message; depth: number }>,
  userEmail?: string,
  forceRecipientDisplay?: boolean
): FromDisplayInfo {
  const seen = new Set<string>();
  const fromTexts: string[] = [];
  const fromTooltips: string[] = [];
  fullFlat.forEach(({ message }) => {
    const normalized = normalizeFromValue(message.from ?? "");
    if (!normalized && !forceRecipientDisplay) return;
    const entry = forceRecipientDisplay
      ? getMessageFromDisplay(
          normalized,
          { to: message.to, cc: message.cc, bcc: message.bcc },
          userEmail,
          true,
          true
        )
      : getMessageFromDisplay(normalized, undefined, userEmail, true, false);
    const key = forceRecipientDisplay
      ? entry.text.toLowerCase()
      : extractPrimaryEmail(normalized) ?? entry.text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    fromTexts.push(entry.text);
    fromTooltips.push(entry.tooltip);
  });
  if (!fromTexts.length) {
    return { text: "", tooltip: "" };
  }
  return {
    text: fromTexts.join(", "),
    tooltip: fromTooltips.join(", ")
  };
}

export type ThreadGroupEntry = {
  threadGroupId: string;
  threadSize: number;
  fullFlat: Array<{ message: Message; depth: number }>;
  flat: Array<{ message: Message; depth: number }>;
  threadFolderIds: string[];
  showThreadFolderBadges: boolean;
  isCollapsed: boolean;
  root: ThreadNode;
};

export type FlatMessageEntry = {
  message: Message;
  threadGroupId: string;
  folderIds: string[];
};

export function isCollapsedThreadRootRow(params: {
  isCollapsed: boolean;
  threadSize: number;
  depth: number;
  threadIndex: number;
}) {
  const { isCollapsed, threadSize, depth, threadIndex } = params;
  return isCollapsed && threadSize > 1 && depth === 0 && threadIndex === 0;
}

export function getDisplaySeenForThreadRow(params: {
  messageSeen: boolean;
  isCollapsed: boolean;
  threadSize: number;
  depth: number;
  threadIndex: number;
  fullFlat: Array<{ message: Message; depth: number }>;
}) {
  const {
    messageSeen,
    isCollapsed,
    threadSize,
    depth,
    threadIndex,
    fullFlat
  } = params;
  if (
    !isCollapsedThreadRootRow({
      isCollapsed,
      threadSize,
      depth,
      threadIndex
    })
  ) {
    return Boolean(messageSeen);
  }
  return fullFlat.every((entry) => Boolean(entry.message.seen));
}

export function buildThreadGroupEntries(params: {
  group: MessageGroup;
  collapsedThreads: Record<string, boolean>;
  includeThreadAcrossFolders: boolean;
  searchScope: "folder" | "all";
  activeFolderId: string;
  buildThreadTree: (items: Message[]) => ThreadNode[];
  flattenThread: (
    node: ThreadNode,
    depth?: number,
    visited?: Set<string>
  ) => Array<{ message: Message; depth: number }>;
  getThreadLatestDate: (node: ThreadNode) => number;
}): ThreadGroupEntry[] {
  const {
    group,
    collapsedThreads,
    includeThreadAcrossFolders,
    searchScope,
    activeFolderId,
    buildThreadTree,
    flattenThread,
    getThreadLatestDate
  } = params;
  return buildThreadTree(group.items)
    .sort((a, b) => getThreadLatestDate(b) - getThreadLatestDate(a))
    .map((root) => {
      const threadGroupId = root.message.threadId ?? root.message.messageId ?? root.message.id;
      const fullFlat = flattenThread(root, 0);
      const threadSize = fullFlat.length;
      const isCollapsed = collapsedThreads[threadGroupId] ?? true;
      const flat = isCollapsed ? [fullFlat[0]] : fullFlat;
      const threadFolderIds = Array.from(
        new Set(fullFlat.map((item) => item.message.folderId))
      );
      const showThreadFolderBadges =
        searchScope === "all" || (includeThreadAcrossFolders && threadFolderIds.length > 1);
      return {
        threadGroupId,
        threadSize,
        fullFlat,
        flat,
        threadFolderIds,
        showThreadFolderBadges,
        isCollapsed,
        root
      };
    });
}

export function buildFlatEntries(params: {
  group: MessageGroup;
  includeThreadAcrossFolders: boolean;
  searchScope: "folder" | "all";
  activeFolderId: string;
}): FlatMessageEntry[] {
  const { group, includeThreadAcrossFolders, searchScope, activeFolderId } = params;
  return group.items.map((message) => {
    const threadGroupId = message.threadId ?? message.messageId ?? message.id;
    const folderIds =
      searchScope === "all" ||
      (includeThreadAcrossFolders && message.folderId !== activeFolderId)
        ? [message.folderId]
        : [];
    return { message, threadGroupId, folderIds };
  });
}
