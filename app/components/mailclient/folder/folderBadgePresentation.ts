import type { Folder } from "@/lib/data";
import { getFolderSpecialKind, type FolderSpecialKind } from "../utils/folderHelpers";

export function getFolderBadgeLabel(
  folder: Pick<Folder, "name" | "specialUse"> | null | undefined,
  fallbackName: string
): string {
  if (getFolderSpecialKind(folder)) return "";
  const name = folder?.name?.trim();
  return name || fallbackName;
}

export function getFolderBadgeKind(
  folder: Pick<Folder, "name" | "specialUse"> | null | undefined
): FolderSpecialKind | "folder" {
  return getFolderSpecialKind(folder) ?? "folder";
}
