import type { Folder } from "@/lib/data";

const ARCHIVE_NAMES = ["archive", "archiv", "archives", "archivio", "archivos"];
const DRAFT_NAMES = [
  "drafts",
  "draft",
  "entw\u00fcrfe",
  "entwuerfe",
  "entwurf",
  "brouillons",
  "borradores"
];
const JUNK_NAMES = [
  "junk",
  "spam",
  "junk email",
  "junk e-mail",
  "bulk",
  "spam mail",
  "spam messages"
];
const SENT_NAMES = [
  "sent",
  "sent items",
  "sent mail",
  "sent messages",
  "gesendet",
  "gesendete",
  "gesendete objekte",
  "gesendete elemente",
  "outbox",
  "enviado",
  "envoy\u00e9s",
  "gesendete nachrichten"
];

type FolderMatchOptions = {
  specialUses?: string[];
  exactNames?: string[];
  idIncludes?: string[];
  nameIncludes?: string[];
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function getAccountFolders(folders: Folder[], accountId: string) {
  return folders.filter((folder) => folder.accountId === accountId);
}

function findFolder(
  folders: Folder[],
  accountId: string,
  options: FolderMatchOptions
) {
  const candidates = getAccountFolders(folders, accountId);
  const specialUses = options.specialUses?.map(normalize) ?? [];
  if (specialUses.length > 0) {
    const bySpecial = candidates.find((folder) =>
      specialUses.includes(normalize(folder.specialUse))
    );
    if (bySpecial) return bySpecial;
  }

  const exactNames = options.exactNames?.map(normalize) ?? [];
  if (exactNames.length > 0) {
    const byName = candidates.find((folder) =>
      exactNames.includes(normalize(folder.name))
    );
    if (byName) return byName;
  }

  const idIncludes = options.idIncludes?.map(normalize) ?? [];
  if (idIncludes.length > 0) {
    const byId = candidates.find((folder) => {
      const id = normalize(folder.id);
      return idIncludes.some((needle) => id.includes(needle));
    });
    if (byId) return byId;
  }

  const nameIncludes = options.nameIncludes?.map(normalize) ?? [];
  if (nameIncludes.length > 0) {
    const byPartial = candidates.find((folder) => {
      const name = normalize(folder.name);
      return nameIncludes.some((needle) => name.includes(needle));
    });
    if (byPartial) return byPartial;
  }

  return null;
}

export function findArchiveFolder(folders: Folder[], accountId: string) {
  return findFolder(folders, accountId, {
    specialUses: ["\\archive"],
    exactNames: ARCHIVE_NAMES,
    idIncludes: ARCHIVE_NAMES
  });
}

export function findDraftsFolder(folders: Folder[], accountId: string) {
  return findFolder(folders, accountId, {
    specialUses: ["\\drafts"],
    exactNames: DRAFT_NAMES,
    idIncludes: DRAFT_NAMES,
    nameIncludes: ["draft"]
  });
}

export function findInboxFolder(folders: Folder[], accountId: string) {
  return findFolder(folders, accountId, {
    specialUses: ["\\inbox"],
    exactNames: ["inbox"]
  });
}

export function findJunkFolder(folders: Folder[], accountId: string) {
  return findFolder(folders, accountId, {
    specialUses: ["\\junk", "\\spam"],
    exactNames: JUNK_NAMES,
    idIncludes: JUNK_NAMES,
    nameIncludes: ["junk", "spam"]
  });
}

export function findSentFolder(folders: Folder[], accountId: string) {
  return findFolder(folders, accountId, {
    exactNames: SENT_NAMES,
    idIncludes: SENT_NAMES,
    nameIncludes: ["sent"]
  });
}

export function findTrashFolder(folders: Folder[], accountId: string) {
  return findFolder(folders, accountId, {
    specialUses: ["\\trash"]
  });
}

// --- Predicate / classification API ----------------------------------------
//
// The `find*Folder` functions above are intentionally permissive — they are
// the "best-effort" lookup a client uses when it needs to *discover* which
// folder in an account plays a given role. The predicates below are stricter:
// they classify a folder you already have by its server-provided `specialUse`
// (and, where applicable, a narrow set of well-known names), and they are
// used on hot paths like rendering message rows and deciding whether a move
// should be treated as "delete permanently".

export type FolderSpecialKind =
  | "inbox"
  | "sent"
  | "drafts"
  | "trash"
  | "spam"
  | "archive";

/**
 * Classifies a single folder by its server-provided `specialUse` attribute,
 * with a narrow name-based fallback for the roles where a well-known folder
 * name ("Inbox", "Sent", "Drafts", "Junk", "Archive") is a reliable signal.
 *
 * Note: returns `"trash"` only for an explicit `\Trash` specialUse — there is
 * no name-based fallback for trash, because a folder literally named "Trash"
 * without the IMAP attribute is rare and we prefer false-negatives to
 * false-positives for destructive actions.
 */
export function getFolderSpecialKind(
  folder: Pick<Folder, "name" | "specialUse"> | null | undefined
): FolderSpecialKind | null {
  const special = (folder?.specialUse ?? "").toLowerCase();
  const name = (folder?.name ?? "").trim().toLowerCase();

  if (special === "\\inbox" || name === "inbox") return "inbox";
  if (special === "\\sent" || name === "sent") return "sent";
  if (special === "\\drafts" || name === "drafts") return "drafts";
  if (special === "\\trash") return "trash";
  if (special === "\\junk" || special === "\\spam" || name === "junk") return "spam";
  if (special === "\\archive" || name === "archive") return "archive";
  return null;
}

/**
 * Predicate form of `getFolderSpecialKind` for the "sent" role. Takes the
 * folder record directly (not an id), which is useful when the caller is
 * already iterating folders.
 */
export function isSentFolderRecord(
  folder: Pick<Folder, "name" | "specialUse"> | null | undefined
): boolean {
  return getFolderSpecialKind(folder) === "sent";
}

function findFolderRecord(folderId: string | null | undefined, folders: Folder[]) {
  if (!folderId) return null;
  return folders.find((item) => item.id === folderId) ?? null;
}

/** Strict: matches only folders whose `specialUse` is the IMAP `\Drafts` token. */
export function isDraftsFolder(
  folderId: string | null | undefined,
  folders: Folder[]
): boolean {
  const folder = findFolderRecord(folderId, folders);
  if (!folder) return false;
  return (folder.specialUse ?? "").toLowerCase() === "\\drafts";
}

/** Strict: matches only folders whose `specialUse` is the IMAP `\Trash` token. */
export function isTrashFolder(
  folderId: string | null | undefined,
  folders: Folder[]
): boolean {
  const folder = findFolderRecord(folderId, folders);
  if (!folder) return false;
  return (folder.specialUse ?? "").toLowerCase() === "\\trash";
}

/**
 * Permissive: matches `\Junk` / `\Spam` specialUse OR any folder whose name
 * contains "junk" or "spam" (case-insensitive).
 */
export function isSpamFolder(
  folderId: string | null | undefined,
  folders: Folder[]
): boolean {
  const folder = findFolderRecord(folderId, folders);
  if (!folder) return false;
  const special = (folder.specialUse ?? "").toLowerCase();
  if (special === "\\junk" || special === "\\spam") return true;
  const name = folder.name.toLowerCase();
  return name.includes("junk") || name.includes("spam");
}

/** Same rule as `isSentFolderRecord`, but takes a folderId. */
export function isSentFolder(
  folderId: string | null | undefined,
  folders: Folder[]
): boolean {
  const folder = findFolderRecord(folderId, folders);
  return isSentFolderRecord(folder);
}

/**
 * Folders we don't want to surface in new-message notifications: drafts,
 * trash, spam, and the user's own sent folder.
 *
 * Inlines the four role checks against a single folder lookup instead of
 * calling the individual predicates, each of which would re-scan `folders`.
 * This is on the per-message notification hot path in `useSyncController`.
 */
export function isNotificationSuppressedFolder(
  folderId: string | null | undefined,
  folders: Folder[]
): boolean {
  const folder = findFolderRecord(folderId, folders);
  if (!folder) return false;
  const special = (folder.specialUse ?? "").toLowerCase();
  if (
    special === "\\drafts" ||
    special === "\\trash" ||
    special === "\\junk" ||
    special === "\\spam"
  ) {
    return true;
  }
  const name = folder.name.toLowerCase();
  if (name.includes("junk") || name.includes("spam")) return true;
  return isSentFolderRecord(folder);
}

/**
 * Folders that should be excluded when building thread views (trash / junk /
 * spam) — their messages shouldn't pull unrelated folders into a thread.
 *
 * Stricter than `isSpamFolder`: only specialUse matches, no name fallback.
 */
export function isThreadExcludedFolder(
  folderId: string | null | undefined,
  folders: Folder[]
): boolean {
  const folder = findFolderRecord(folderId, folders);
  if (!folder) return false;
  const special = (folder.specialUse ?? "").toLowerCase();
  return special === "\\trash" || special === "\\junk" || special === "\\spam";
}
