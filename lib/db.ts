export {
  closeAllDbConnections,
  initializeMasterDb,
  withAccountDb
} from "./db/connection";
import {
  type GroupMeta,
  type StoredMessageSummary,
  getAttachmentIds,
  getAttachmentMeta,
  getMessageById,
  getStoredMessagesByIds,
  listFolderMessageUidAndFlagRows,
  listFolderMessageUidRows,
  listMessageFileRefs,
  listMessageFileRefsByMessageIds,
  listMessages,
  listRelatedMessages,
  listThreadMessages,
  listThreads
} from "./db/messages";
export {
  type GroupMeta,
  type StoredMessageSummary,
  getAttachmentIds,
  getAttachmentMeta,
  getMessageById,
  getStoredMessagesByIds,
  listFolderMessageUidAndFlagRows,
  listFolderMessageUidRows,
  listMessageFileRefs,
  listMessageFileRefsByMessageIds,
  listMessages,
  listRelatedMessages,
  listThreadMessages,
  listThreads
};

export {
  deleteMessageByFolderUid,
  deleteMessageById,
  deleteMessagesByFolderPrefix,
  deleteMessagesByIds,
  deleteMessagesWithFilesByIds
} from "./db/messages";

export {
  type RelocateMovedMessageResult,
  type StagedMessageMove,
  getPendingMoveSourceUids,
  hasPendingMovesForFolder,
  stageMessageMoves,
  updateMessagesFolderPrefix
} from "./db/messages";
import {
  relocateMovedMessage as _relocateMovedMessageImpl,
  updateMessageFolder as _updateMessageFolderImpl
} from "./db/messages";

/**
 * Thin wrapper that delegates to the extracted implementation. Defined
 * as a concrete function binding on the public `@/lib/db` namespace so
 * that tests using Bun's `mock.module("@/lib/db", …)` can override the
 * symbol in isolation; Bun's mock registry persists for the lifetime of
 * the worker and mutates the target namespace's live bindings in place,
 * so the alternative — a plain re-export — leaves every sibling module
 * importing from `./db/messages/move` through the same live binding
 * vulnerable to cross-file mock leakage.
 */
export function updateMessageFolder(
  accountId: string,
  messageId: string,
  folderId: string,
  mailboxPath: string,
  imapUid?: number | null
) {
  return _updateMessageFolderImpl(accountId, messageId, folderId, mailboxPath, imapUid);
}

/** Same rationale as `updateMessageFolder` above. */
export function relocateMovedMessage(
  params: Parameters<typeof _relocateMovedMessageImpl>[0]
) {
  return _relocateMovedMessageImpl(params);
}

export {
  bulkUpdateMessageFlags,
  setMessageCategory,
  updateMessageFlags
} from "./db/messages";

export {
  getFolderIdsByMessageIds,
  getLatestMessageDate,
  getLatestMessageUid,
  listRecipientSuggestions
} from "./db/messages";

export { upsertMessages } from "./db/messages";

export {
  getTombstonedDraftMessageIds,
  recordDraftTombstone,
  removeDraftTombstone
} from "./db/messages";

export {
  addTopicSignalExclusion,
  clearTopicSignalExclusions,
  deleteTopicLearningSignals,
  upsertTopicLearningSignalsForThreadIds
} from "./db/topics";

export {
  deleteAccountControlPlane,
  getAccountById,
  getAccounts,
  getAccountsForUser,
  patchAccount,
  saveAccounts,
  upsertAccount
} from "./db/accounts";

export {
  addUserAccountLink,
  getUserAccounts,
  getUserById,
  getUsers,
  listAccessibleAccountIdsForUser,
  saveUserAccounts,
  saveUsers
} from "./db/users";

export {
  deleteMcpToken,
  getMcpTokenByHash,
  insertMcpToken,
  listMcpTokens,
  touchMcpTokenLastUsed,
  type StoredMcpTokenRecord
} from "./db/mcpTokens";

export {
  claimInviteCode,
  createInviteCode,
  getInviteCodes,
  saveInviteCodes
} from "./db/inviteCodes";

export {
  getFolders,
  getMailboxState,
  saveFoldersForAccount,
  saveMailboxState,
  updateMailboxHighestUid
} from "./db/folders";

export {
  getThreadIdsByMessageIds,
  getMessageIdsByMessageIds,
  getThreadMessageIdsForMove,
  recomputeThreadsForAccount,
  recomputeThreadIdsForAccount,
  resolveThreadingForAccountMessages
} from "./db/threads";

export {
  clearCalendarReminders,
  deleteCalendarReminderById,
  deleteCalendarReminderByEvent,
  listCalendarReminders,
  listDeleteCalendarAssociations,
  upsertCalendarReminder
} from "./db/calendar";


export {
  deleteMessageCalendarInviteStateByMessageAndEvent,
  listFullyProcessedCalendarInviteMessageIds
} from "./db/calendar";

export {
  applyCategoryFeedback,
  getCategoryLearningDebugSnapshot,
  getCategoryLinearModel,
  recomputeCategoriesForAccount,
  resetCategoryLinearModel
} from "./db/categories";

export {
  type CalendarParticipationResolution,
  deleteCalendarParticipationOverrideForOccurrence,
  listCalendarEvents,
  listCalendarEventsBySource,
  listSoftDeletedCaldavEventsToPush,
  resolveCalendarParticipation,
  upsertCalendarEvent,
  upsertCalendarParticipationOverride
} from "./db/calendar";

export { type CalendarEventConflict } from "./db/calendar";

/*
 * Concrete wrappers for the calendar functions that tests replace via
 * Bun's `mock.module("@/lib/db", …)`. Bun mutates the target namespace's
 * live bindings in place, and its `mock.restore()` does not undo that
 * mutation — which means a plain re-export `export { foo } from "./db/calendar"`
 * leaves every consumer (including the `./db.ts?test-harness` isolated
 * loader) resolving `foo` through the shared source module where the
 * mock leaked. Wrapping each mocked symbol as a concrete binding on the
 * public `@/lib/db` namespace keeps the mock scoped to the wrapper and
 * leaves sibling modules importing from `./db/calendar/*` untouched.
 *
 * See the `updateMessageFolder` wrapper higher up in this file for the
 * same pattern and rationale.
 */
import {
  addCalendarEventSuppression as _addCalendarEventSuppressionImpl,
  cancelCalendarEventByUid as _cancelCalendarEventByUidImpl,
  cancelCalendarRemindersByEventUid as _cancelCalendarRemindersByEventUidImpl,
  clearMessageCalendarInviteStatesProcessedByEventUid as _clearMessageCalendarInviteStatesProcessedByEventUidImpl,
  isCalendarEventSuppressed as _isCalendarEventSuppressedImpl,
  removeCalendarEventSuppression as _removeCalendarEventSuppressionImpl,
  deleteCalendarEvent as _deleteCalendarEventImpl,
  ensureCalendarReminder as _ensureCalendarReminderImpl,
  getCalendarEventById as _getCalendarEventByIdImpl,
  getCalendarEventByUid as _getCalendarEventByUidImpl,
  listSiblingCalendarEventsByUidKey as _listSiblingCalendarEventsByUidKeyImpl,
  listCalendarInviteSourceMessagesByEventUid as _listCalendarInviteSourceMessagesByEventUidImpl,
  getMessageCalendarSnapshot as _getMessageCalendarSnapshotImpl,
  getPriorCalendarSnapshot as _getPriorCalendarSnapshotImpl,
  listMessageCalendarEventUids as _listMessageCalendarEventUidsImpl,
  markMessageCalendarInviteStatesProcessed as _markMessageCalendarInviteStatesProcessedImpl,
  markMessageCalendarInviteStatesUnprocessed as _markMessageCalendarInviteStatesUnprocessedImpl,
  rescheduleCalendarRemindersByEventUid as _rescheduleCalendarRemindersByEventUidImpl,
  softDeleteCalendarEvent as _softDeleteCalendarEventImpl,
  upsertCalendarEventByUid as _upsertCalendarEventByUidImpl,
  upsertMessageCalendarInviteStates as _upsertMessageCalendarInviteStatesImpl,
  deleteCalendarEventConflict as _deleteCalendarEventConflictImpl,
  getCalendarEventConflict as _getCalendarEventConflictImpl,
  listUnresolvedCalendarEventConflicts as _listUnresolvedCalendarEventConflictsImpl,
  upsertCalendarEventConflict as _upsertCalendarEventConflictImpl
} from "./db/calendar";

export function deleteCalendarEventConflict(
  ...args: Parameters<typeof _deleteCalendarEventConflictImpl>
): ReturnType<typeof _deleteCalendarEventConflictImpl> {
  return _deleteCalendarEventConflictImpl(...args);
}

export function getCalendarEventConflict(
  ...args: Parameters<typeof _getCalendarEventConflictImpl>
): ReturnType<typeof _getCalendarEventConflictImpl> {
  return _getCalendarEventConflictImpl(...args);
}

export function listUnresolvedCalendarEventConflicts(
  ...args: Parameters<typeof _listUnresolvedCalendarEventConflictsImpl>
): ReturnType<typeof _listUnresolvedCalendarEventConflictsImpl> {
  return _listUnresolvedCalendarEventConflictsImpl(...args);
}

export function upsertCalendarEventConflict(
  ...args: Parameters<typeof _upsertCalendarEventConflictImpl>
): ReturnType<typeof _upsertCalendarEventConflictImpl> {
  return _upsertCalendarEventConflictImpl(...args);
}

export function getCalendarEventById(
  ...args: Parameters<typeof _getCalendarEventByIdImpl>
): ReturnType<typeof _getCalendarEventByIdImpl> {
  return _getCalendarEventByIdImpl(...args);
}

export function getCalendarEventByUid(
  ...args: Parameters<typeof _getCalendarEventByUidImpl>
): ReturnType<typeof _getCalendarEventByUidImpl> {
  return _getCalendarEventByUidImpl(...args);
}

export function listSiblingCalendarEventsByUidKey(
  ...args: Parameters<typeof _listSiblingCalendarEventsByUidKeyImpl>
): ReturnType<typeof _listSiblingCalendarEventsByUidKeyImpl> {
  return _listSiblingCalendarEventsByUidKeyImpl(...args);
}

export function softDeleteCalendarEvent(
  ...args: Parameters<typeof _softDeleteCalendarEventImpl>
): ReturnType<typeof _softDeleteCalendarEventImpl> {
  return _softDeleteCalendarEventImpl(...args);
}

export function deleteCalendarEvent(
  ...args: Parameters<typeof _deleteCalendarEventImpl>
): ReturnType<typeof _deleteCalendarEventImpl> {
  return _deleteCalendarEventImpl(...args);
}

export function cancelCalendarEventByUid(
  ...args: Parameters<typeof _cancelCalendarEventByUidImpl>
): ReturnType<typeof _cancelCalendarEventByUidImpl> {
  return _cancelCalendarEventByUidImpl(...args);
}

export function upsertCalendarEventByUid(
  ...args: Parameters<typeof _upsertCalendarEventByUidImpl>
): ReturnType<typeof _upsertCalendarEventByUidImpl> {
  return _upsertCalendarEventByUidImpl(...args);
}

export function ensureCalendarReminder(
  ...args: Parameters<typeof _ensureCalendarReminderImpl>
): ReturnType<typeof _ensureCalendarReminderImpl> {
  return _ensureCalendarReminderImpl(...args);
}

export function cancelCalendarRemindersByEventUid(
  ...args: Parameters<typeof _cancelCalendarRemindersByEventUidImpl>
): ReturnType<typeof _cancelCalendarRemindersByEventUidImpl> {
  return _cancelCalendarRemindersByEventUidImpl(...args);
}

export function rescheduleCalendarRemindersByEventUid(
  ...args: Parameters<typeof _rescheduleCalendarRemindersByEventUidImpl>
): ReturnType<typeof _rescheduleCalendarRemindersByEventUidImpl> {
  return _rescheduleCalendarRemindersByEventUidImpl(...args);
}

export function upsertMessageCalendarInviteStates(
  ...args: Parameters<typeof _upsertMessageCalendarInviteStatesImpl>
): ReturnType<typeof _upsertMessageCalendarInviteStatesImpl> {
  return _upsertMessageCalendarInviteStatesImpl(...args);
}

export function markMessageCalendarInviteStatesProcessed(
  ...args: Parameters<typeof _markMessageCalendarInviteStatesProcessedImpl>
): ReturnType<typeof _markMessageCalendarInviteStatesProcessedImpl> {
  return _markMessageCalendarInviteStatesProcessedImpl(...args);
}

export function markMessageCalendarInviteStatesUnprocessed(
  ...args: Parameters<typeof _markMessageCalendarInviteStatesUnprocessedImpl>
): ReturnType<typeof _markMessageCalendarInviteStatesUnprocessedImpl> {
  return _markMessageCalendarInviteStatesUnprocessedImpl(...args);
}

export function clearMessageCalendarInviteStatesProcessedByEventUid(
  ...args: Parameters<typeof _clearMessageCalendarInviteStatesProcessedByEventUidImpl>
): ReturnType<typeof _clearMessageCalendarInviteStatesProcessedByEventUidImpl> {
  return _clearMessageCalendarInviteStatesProcessedByEventUidImpl(...args);
}

export function addCalendarEventSuppression(
  ...args: Parameters<typeof _addCalendarEventSuppressionImpl>
): ReturnType<typeof _addCalendarEventSuppressionImpl> {
  return _addCalendarEventSuppressionImpl(...args);
}

export function isCalendarEventSuppressed(
  ...args: Parameters<typeof _isCalendarEventSuppressedImpl>
): ReturnType<typeof _isCalendarEventSuppressedImpl> {
  return _isCalendarEventSuppressedImpl(...args);
}

export function removeCalendarEventSuppression(
  ...args: Parameters<typeof _removeCalendarEventSuppressionImpl>
): ReturnType<typeof _removeCalendarEventSuppressionImpl> {
  return _removeCalendarEventSuppressionImpl(...args);
}

export function getMessageCalendarSnapshot(
  ...args: Parameters<typeof _getMessageCalendarSnapshotImpl>
): ReturnType<typeof _getMessageCalendarSnapshotImpl> {
  return _getMessageCalendarSnapshotImpl(...args);
}

export function getPriorCalendarSnapshot(
  ...args: Parameters<typeof _getPriorCalendarSnapshotImpl>
): ReturnType<typeof _getPriorCalendarSnapshotImpl> {
  return _getPriorCalendarSnapshotImpl(...args);
}

export function listMessageCalendarEventUids(
  ...args: Parameters<typeof _listMessageCalendarEventUidsImpl>
): ReturnType<typeof _listMessageCalendarEventUidsImpl> {
  return _listMessageCalendarEventUidsImpl(...args);
}

export function listCalendarInviteSourceMessagesByEventUid(
  ...args: Parameters<typeof _listCalendarInviteSourceMessagesByEventUidImpl>
): ReturnType<typeof _listCalendarInviteSourceMessagesByEventUidImpl> {
  return _listCalendarInviteSourceMessagesByEventUidImpl(...args);
}
