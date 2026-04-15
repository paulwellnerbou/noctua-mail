/**
 * Folder utility functions that don't belong in `lib/specialFolders.ts`
 * because they have nothing to do with classifying folders by role. These
 * are pure tree / ordering helpers used by the sidebar and move-target UI.
 *
 * For classification (`isDraftsFolder`, `getFolderSpecialKind`, etc.)
 * import from `@/lib/specialFolders`.
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
