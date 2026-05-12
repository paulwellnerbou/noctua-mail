import type { Message, RecipientAlias } from "@/lib/data";
import {
  extractDisplayName,
  extractPrimaryEmail,
  normalizeWhitespace
} from "@/lib/senderIdentity";
import type { ThreadNode } from "./threadTree";

type MessageGroup = {
  key: string;
  label?: string;
  items: Message[];
  count?: number;
};

export type FromDisplayInfo = {
  text: string;
  tooltip: string;
  isFromUser?: boolean;
  showRecipientIcon?: boolean;
  iconFrom?: string;
  iconFromEmail?: string | null;
};

type RecipientFields = {
  to?: string;
  cc?: string;
  bcc?: string;
};

type FindRecipientAlias = (value?: string | null) => RecipientAlias | null;
type ParticipantEntry = {
  text: string;
  tooltip: string;
  key: string;
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

const getRecipientAlias = (
  fields?: RecipientFields,
  findRecipientAlias?: FindRecipientAlias
) => {
  if (!fields || !findRecipientAlias) return null;
  const candidateValues = [fields.to, fields.cc, fields.bcc]
    .map((value) => value?.trim())
    .filter(Boolean);
  if (candidateValues.length !== 1) return null;
  return findRecipientAlias(candidateValues[0]) ?? null;
};

const extractRecipientsDisplay = (
  fields?: RecipientFields,
  findRecipientAlias?: FindRecipientAlias
): string => {
  if (!fields) return "";
  const alias = getRecipientAlias(fields, findRecipientAlias);
  if (alias) return alias.name;
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

const getRecipientParticipantEntries = (
  fields?: RecipientFields,
  userEmail?: string,
  findRecipientAlias?: FindRecipientAlias
): ParticipantEntry[] => {
  if (!fields) return [];
  const tooltip = recipientTooltip(fields);
  if (!tooltip) return [];

  const alias = getRecipientAlias(fields, findRecipientAlias);
  if (alias) {
    return [
      {
        text: alias.name,
        tooltip,
        key: `alias:${alias.id}`
      }
    ];
  }

  const normalizedUserEmail = userEmail?.trim().toLowerCase() ?? null;
  const seen = new Set<string>();
  const entries: ParticipantEntry[] = [];

  [fields.to, fields.cc, fields.bcc].forEach((value) => {
    splitRecipients(value).forEach((recipient) => {
      const email = extractPrimaryEmail(recipient);
      if (email && normalizedUserEmail && email === normalizedUserEmail) return;
      const text = recipientDisplayValue(recipient);
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        text,
        tooltip: recipient,
        key
      });
    });
  });

  return entries;
};

const getOtherRecipientParticipant = (fields?: RecipientFields, userEmail?: string) => {
  const normalizedUserEmail = userEmail?.trim().toLowerCase() ?? null;
  for (const value of [fields?.to, fields?.cc, fields?.bcc]) {
    for (const recipient of splitRecipients(value)) {
      const email = extractPrimaryEmail(recipient);
      if (email && normalizedUserEmail && email === normalizedUserEmail) continue;
      return {
        from: recipient,
        fromEmail: email
      };
    }
  }
  return null;
};

export function getMessageFromDisplay(
  fromValue: string,
  recipients?: RecipientFields,
  userEmail?: string,
  isInExpandedThread?: boolean,
  forceRecipientDisplay?: boolean,
  findRecipientAlias?: FindRecipientAlias
): FromDisplayInfo {
  const normalized = normalizeWhitespace(fromValue);
  if (!normalized && !forceRecipientDisplay) return { text: "", tooltip: "" };

  const isFromUser = normalized ? isMessageFromUser(normalized, userEmail) : false;

  if (forceRecipientDisplay) {
    const recipientsDisplay = extractRecipientsDisplay(recipients, findRecipientAlias);
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
    const recipientsDisplay = extractRecipientsDisplay(recipients, findRecipientAlias);
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
    showRecipientIcon: false,
    iconFrom: normalized,
    iconFromEmail: extractPrimaryEmail(normalized)
  };
}

export function getCollapsedThreadIconParticipant(
  fullFlat: Array<{ message: Message; depth: number }>,
  userEmail?: string
) {
  const normalizedUserEmail = userEmail?.trim().toLowerCase() ?? null;

  for (const { message } of fullFlat) {
    const normalizedFrom = normalizeWhitespace(message.from ?? "");
    if (!normalizedFrom) continue;
    const fromEmail = extractPrimaryEmail(normalizedFrom);
    if (fromEmail && normalizedUserEmail && fromEmail === normalizedUserEmail) continue;
    return {
      from: normalizedFrom,
      fromEmail
    };
  }

  for (const { message } of fullFlat) {
    const recipient = getOtherRecipientParticipant(
      { to: message.to, cc: message.cc, bcc: message.bcc },
      userEmail
    );
    if (recipient) return recipient;
  }

  return null;
}

export function getCollapsedThreadFromDisplay(
  fullFlat: Array<{ message: Message; depth: number }>,
  userEmail?: string,
  forceRecipientDisplay?: boolean,
  findRecipientAlias?: FindRecipientAlias
): FromDisplayInfo {
  const seen = new Set<string>();
  const fromTexts: string[] = [];
  const fromTooltips: string[] = [];
  const pushParticipant = (participant: ParticipantEntry) => {
    if (seen.has(participant.key)) return;
    seen.add(participant.key);
    fromTexts.push(participant.text);
    fromTooltips.push(participant.tooltip);
  };

  fullFlat.forEach(({ message }) => {
    const normalized = normalizeWhitespace(message.from ?? "");
    if (!normalized && !forceRecipientDisplay) return;

    if (forceRecipientDisplay) {
      const entry = getMessageFromDisplay(
        normalized,
        { to: message.to, cc: message.cc, bcc: message.bcc },
        userEmail,
        true,
        true,
        findRecipientAlias
      );
      pushParticipant({
        text: entry.text,
        tooltip: entry.tooltip,
        key: entry.text.toLowerCase()
      });
      return;
    }

    const senderEntry = getMessageFromDisplay(
      normalized,
      undefined,
      userEmail,
      true,
      false,
      findRecipientAlias
    );
    pushParticipant({
      text: senderEntry.text,
      tooltip: senderEntry.tooltip,
      key: senderEntry.text.toLowerCase()
    });

    if (!senderEntry.isFromUser) return;

    getRecipientParticipantEntries(
      { to: message.to, cc: message.cc, bcc: message.bcc },
      userEmail,
      findRecipientAlias
    ).forEach(pushParticipant);
  });
  if (!fromTexts.length) {
    return { text: "", tooltip: "" };
  }
  const iconParticipant = getCollapsedThreadIconParticipant(fullFlat, userEmail);
  return {
    text: fromTexts.join(", "),
    tooltip: fromTooltips.join(", "),
    iconFrom: iconParticipant?.from,
    iconFromEmail: iconParticipant?.fromEmail ?? null
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

export type VisibleThreadRow = {
  message: Message;
  depth: number;
  isLastInDepth: boolean;
  hasChildren: boolean;
  isNestedCollapsed: boolean;
  ancestorStopsHere: boolean[];
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

export const getThreadSubtreeEntries = (
  fullFlat: Array<{ message: Message; depth: number }>,
  messageId: string
) => {
  const startIndex = fullFlat.findIndex((entry) => entry.message.id === messageId);
  if (startIndex === -1) return [];

  const baseDepth = fullFlat[startIndex].depth;
  const subtree = [fullFlat[startIndex]];
  for (let i = startIndex + 1; i < fullFlat.length; i++) {
    if (fullFlat[i].depth <= baseDepth) break;
    subtree.push(fullFlat[i]);
  }
  return subtree;
};

export function getThreadSubtreeMessageIds(
  fullFlat: Array<{ message: Message; depth: number }>,
  messageId: string
) {
  return getThreadSubtreeEntries(fullFlat, messageId).map((entry) => entry.message.id);
}

export function hasThreadSubtreeChildren(
  fullFlat: Array<{ message: Message; depth: number }>,
  messageId: string
) {
  const subtree = getThreadSubtreeEntries(fullFlat, messageId);
  return subtree.length > 1;
}

export function getDisplaySeenForThreadRow(params: {
  messageSeen: boolean;
  messageId?: string;
  isCollapsed: boolean;
  threadSize: number;
  depth: number;
  threadIndex: number;
  isNestedCollapsed?: boolean;
  fullFlat: Array<{ message: Message; depth: number }>;
}) {
  const {
    messageSeen,
    messageId,
    isCollapsed,
    threadSize,
    depth,
    threadIndex,
    isNestedCollapsed,
    fullFlat
  } = params;
  const isCollapsedRoot = isCollapsedThreadRootRow({
    isCollapsed,
    threadSize,
    depth,
    threadIndex
  });
  if (isCollapsedRoot) {
    return fullFlat.every((entry) => Boolean(entry.message.seen));
  }
  if (isNestedCollapsed && messageId) {
    const subtree = getThreadSubtreeEntries(fullFlat, messageId);
    if (subtree.length > 0) {
      return subtree.every((entry) => Boolean(entry.message.seen));
    }
  }
  return Boolean(messageSeen);
}

export function getThreadMessagesForThreadRow(params: {
  message: Message;
  messageId?: string;
  isCollapsed: boolean;
  threadSize: number;
  depth: number;
  threadIndex: number;
  isNestedCollapsed?: boolean;
  fullFlat: Array<{ message: Message; depth: number }>;
}) {
  const {
    message,
    messageId,
    isCollapsed,
    threadSize,
    depth,
    threadIndex,
    isNestedCollapsed,
    fullFlat
  } = params;
  const isCollapsedRoot = isCollapsedThreadRootRow({
    isCollapsed,
    threadSize,
    depth,
    threadIndex
  });
  if (isCollapsedRoot) {
    return fullFlat.map((entry) => entry.message);
  }
  if (isNestedCollapsed && messageId) {
    const subtree = getThreadSubtreeEntries(fullFlat, messageId);
    if (subtree.length > 0) {
      return subtree.map((entry) => entry.message);
    }
  }
  return [message];
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
  const getThreadSortDate = (node: ThreadNode) => {
    const explicit = Number(node.message.threadSortDateValue);
    if (Number.isFinite(explicit)) return explicit;
    return getThreadLatestDate(node);
  };
  return buildThreadTree(group.items)
    .sort((a, b) => getThreadSortDate(b) - getThreadSortDate(a))
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

export function buildVisibleThreadRows(params: {
  flat: Array<{ message: Message; depth: number }>;
  collapsedNestedMessages: Record<string, boolean>;
}): VisibleThreadRow[] {
  const { flat, collapsedNestedMessages } = params;
  if (flat.length === 0) return [];

  const childrenMap = new Map<string, Set<string>>();
  flat.forEach(({ message, depth }, index) => {
    if (index === 0) return;
    for (let i = index - 1; i >= 0; i--) {
      if (flat[i].depth < depth) {
        const parentId = flat[i].message.id;
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, new Set());
        }
        childrenMap.get(parentId)!.add(message.id);
        break;
      }
    }
  });

  const visibleFlat = flat.filter((_, index) => {
    if (index === 0) return true;
    const depth = flat[index].depth;
    for (let i = index - 1; i >= 0; i--) {
      if (flat[i].depth < depth && collapsedNestedMessages[flat[i].message.id]) {
        return false;
      }
    }
    return true;
  });

  const isLastChildOfParent = new Map<number, boolean>();
  visibleFlat.forEach(({ depth }, index) => {
    if (depth === 0) {
      const hasNextRoot = visibleFlat.slice(index + 1).some((item) => item.depth === 0);
      isLastChildOfParent.set(index, !hasNextRoot);
      return;
    }
    let hasNextSibling = false;
    for (let i = index + 1; i < visibleFlat.length; i++) {
      if (visibleFlat[i].depth < depth) break;
      if (visibleFlat[i].depth === depth) {
        hasNextSibling = true;
        break;
      }
    }
    isLastChildOfParent.set(index, !hasNextSibling);
  });

  const ancestorStopsHere = new Map<number, boolean[]>();
  visibleFlat.forEach(({ depth }, index) => {
    const stops: boolean[] = [];
    const ancestors: number[] = [];
    for (let d = depth - 1; d >= 0; d--) {
      for (let i = index - 1; i >= 0; i--) {
        if (visibleFlat[i].depth === d) {
          ancestors.unshift(i);
          break;
        }
      }
    }
    ancestors.forEach((ancestorIndex, d) => {
      stops[d] = isLastChildOfParent.get(ancestorIndex) ?? false;
    });
    ancestorStopsHere.set(index, stops);
  });

  return visibleFlat.map(({ message, depth }, index) => ({
    message,
    depth,
    isLastInDepth: isLastChildOfParent.get(index) ?? false,
    hasChildren: (childrenMap.get(message.id)?.size ?? 0) > 0,
    isNestedCollapsed: collapsedNestedMessages[message.id] ?? false,
    ancestorStopsHere: ancestorStopsHere.get(index) ?? []
  }));
}
