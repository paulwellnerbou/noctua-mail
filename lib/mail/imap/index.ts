// Public API for @/lib/mail/imap.
//
// Implementation is split across sibling files:
//   - parser.ts: ImapBodyStructure + extractMessageStructureMetadata
//   - mailbox.ts: STATUS / UID listing snapshots + helpers
//   - sync.ts: planImapNewSyncFolders, syncImapAccountBatched,
//     syncImapMessage, findMissingStoredMailboxCopies + related types
//   - mutations.ts: append, move, delete, flag updates
//   - folders.ts: folder CRUD (list / create / rename / delete / unsubscribe)
//   - _shared.ts: private cross-file plumbing (not re-exported)
//
// Prefer importing from "@/lib/mail/imap" rather than the sibling files
// directly; the re-exports here keep the surface stable for the rest of
// the codebase.

export type { ImapBodyStructure } from "./parser";
export { extractMessageStructureMetadata } from "./parser";

export type {
  ImapMailboxStatusSnapshot,
  ImapMailboxUidFlagSnapshot,
  ImapMailboxUidSnapshot
} from "./mailbox";
export {
  getImapMailboxStatus,
  listImapMailboxUids,
  listImapMailboxUidsAndFlags
} from "./mailbox";

export type {
  ImapSyncBatch,
  NewSyncFolderDecision,
  StoredMailboxCopyCandidate
} from "./sync";
export {
  findMissingStoredMailboxCopies,
  planImapNewSyncFolders,
  syncImapAccountBatched,
  syncImapMessage
} from "./sync";

export type { ImapFlagTarget } from "./mutations";
export {
  appendImapMessage,
  deleteImapMessage,
  deleteImapMessages,
  moveImapMessage,
  moveImapMessages,
  updateImapFlags,
  updateImapFlagsBulk
} from "./mutations";

export {
  createImapFolder,
  deleteImapFolder,
  listImapFolders,
  renameImapFolder,
  unsubscribeImapFolder
} from "./folders";
