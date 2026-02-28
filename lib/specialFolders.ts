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
