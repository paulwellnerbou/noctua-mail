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

const extractToDisplay = (toValue: string): string => {
  if (!toValue) return "";

  // Split by comma to handle multiple recipients
  const recipients = toValue.split(",").map(r => r.trim()).filter(Boolean);

  if (recipients.length === 0) return "";

  // Extract display names or emails for each recipient
  const displayNames = recipients.map(recipient => {
    const displayName = extractDisplayName(recipient);
    if (displayName) return displayName;
    const email = extractPrimaryEmail(recipient);
    return email || recipient;
  });

  return displayNames.join(", ");
};

export function getMessageFromDisplay(
  fromValue: string,
  toValue?: string,
  userEmail?: string,
  isInExpandedThread?: boolean
): FromDisplayInfo {
  const normalized = normalizeFromValue(fromValue);
  if (!normalized) return { text: "", tooltip: "" };

  const isFromUser = isMessageFromUser(normalized, userEmail);

  // For single messages or messages in expanded threads: show "To: ..." if from user
  // isInExpandedThread = false means it's a collapsed thread header (show "Me")
  // isInExpandedThread = true means it's an expanded thread or single message (show "To: ...")
  if (isFromUser && isInExpandedThread && toValue) {
    const toDisplay = extractToDisplay(toValue);
    return {
      text: toDisplay ? `To: ${toDisplay}` : "To: (no recipients)",
      tooltip: toValue || "",
      isFromUser: true
    };
  }

  const displayName = extractDisplayName(normalized);
  const displayText = isFromUser ? "Me" : (displayName || normalized);

  return {
    text: displayText,
    tooltip: normalized,
    isFromUser
  };
}

export function getCollapsedThreadFromDisplay(
  fullFlat: Array<{ message: Message; depth: number }>,
  userEmail?: string
): FromDisplayInfo {
  const seen = new Set<string>();
  const fromTexts: string[] = [];
  const fromTooltips: string[] = [];
  fullFlat.forEach(({ message }) => {
    const normalized = normalizeFromValue(message.from ?? "");
    if (!normalized) return;
    // For collapsed threads, just replace with "Me", don't show "To:"
    const entry = getMessageFromDisplay(normalized, undefined, userEmail, true);
    const key = extractPrimaryEmail(normalized) ?? entry.text.toLowerCase();
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
