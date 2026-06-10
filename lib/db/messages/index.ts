/**
 * Barrel for the messages domain sub-modules. The top-level `lib/db.ts`
 * re-exports from here so that the public `@/lib/db` surface stays stable
 * while the domain splits into focused files (query, retrieval, and the
 * write-side modules that follow).
 */
export {
  listMessages,
  listRelatedMessages,
  listThreads,
  listThreadMessages,
  type GroupMeta
} from "./query";

export {
  getAttachmentIds,
  getAttachmentMeta,
  getMessageById,
  getStoredMessagesByIds,
  type StoredMessageSummary,
  listFolderMessageUidAndFlagRows,
  listFolderMessageUidRows,
  listMessageFileRefs,
  listMessageFileRefsByMessageIds
} from "./retrieval";

export {
  deleteMessageByFolderUid,
  deleteMessageById,
  deleteMessagesByFolderPrefix,
  deleteMessagesByIds,
  deleteMessagesWithFilesByIds
} from "./delete";

export {
  type RelocateMovedMessageResult,
  type StagedMessageMove,
  getPendingMoveSourceUids,
  hasPendingMovesForFolder,
  relocateMovedMessage,
  stageMessageMoves,
  updateMessageFolder,
  updateMessagesFolderPrefix
} from "./move";

export {
  bulkUpdateMessageFlags,
  setMessageCategory,
  updateMessageFlags
} from "./flags";

export {
  getFolderIdsByMessageIds,
  getLatestMessageDate,
  getLatestMessageUid,
  listRecipientSuggestions
} from "./utility";

export { upsertMessages } from "./upsert";
