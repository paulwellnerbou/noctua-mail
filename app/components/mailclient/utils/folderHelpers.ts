/**
 * Folder utility functions
 */
import type { Folder } from "@/lib/data";

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
  if (!folder) return false;
  const special = (folder.specialUse ?? "").toLowerCase();
  return special === "\\sent";
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
