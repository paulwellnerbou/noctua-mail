/**
 * Folder utility functions
 */
import type { Folder } from "@/lib/data";

export type FolderSpecialKind =
  | "inbox"
  | "sent"
  | "drafts"
  | "trash"
  | "spam"
  | "archive";

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

export function isSentFolderRecord(
  folder: Pick<Folder, "name" | "specialUse"> | null | undefined
): boolean {
  return getFolderSpecialKind(folder) === "sent";
}

export function buildFolderTree(items: Folder[]) {
  const map = new Map<string, Folder[]>();
  items.forEach((folder) => {
    const key = folder.parentId ?? "root";
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(folder);
  });

  return map;
}

export function prioritizeFolderIds(
  folderIds: string[],
  priorityIds: Array<string | null | undefined>
): string[] {
  if (folderIds.length < 2) return folderIds.slice();
  const availableIds = new Set(folderIds);
  const ordered: string[] = [];
  const seen = new Set<string>();

  priorityIds.forEach((id) => {
    if (!id || seen.has(id) || !availableIds.has(id)) return;
    seen.add(id);
    ordered.push(id);
  });

  folderIds.forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  });

  return ordered;
}

export function prioritizeFolders(
  folders: Folder[],
  priorityIds: Array<string | null | undefined>
): Folder[] {
  if (folders.length < 2) return folders.slice();
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  return prioritizeFolderIds(
    folders.map((folder) => folder.id),
    priorityIds
  )
    .map((id) => folderById.get(id))
    .filter((folder): folder is Folder => Boolean(folder));
}

export function isDraftsFolder(folderId: string | null | undefined, folders: Folder[]): boolean {
  if (!folderId) return false;
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return false;
  const special = (folder.specialUse ?? "").toLowerCase();
  return special === "\\drafts";
}

export function isTrashFolder(folderId: string | null | undefined, folders: Folder[]): boolean {
  if (!folderId) return false;
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return false;
  const special = (folder.specialUse ?? "").toLowerCase();
  return special === "\\trash";
}

export function isSpamFolder(folderId: string | null | undefined, folders: Folder[]): boolean {
  if (!folderId) return false;
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return false;
  const special = (folder.specialUse ?? "").toLowerCase();
  if (special === "\\junk" || special === "\\spam") return true;
  const name = folder.name.toLowerCase();
  return name.includes("junk") || name.includes("spam");
}

export function isSentFolder(folderId: string | null | undefined, folders: Folder[]): boolean {
  if (!folderId) return false;
  const folder = folders.find((item) => item.id === folderId);
  return isSentFolderRecord(folder);
}

export function isNotificationSuppressedFolder(
  folderId: string | null | undefined,
  folders: Folder[]
): boolean {
  return (
    isDraftsFolder(folderId, folders) ||
    isTrashFolder(folderId, folders) ||
    isSpamFolder(folderId, folders) ||
    isSentFolder(folderId, folders)
  );
}
