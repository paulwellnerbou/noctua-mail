import type { Folder, Message } from "@/lib/data";

/**
 * Find the \\Trash folder for the given account. Matches by
 * `specialUse === "\\Trash"` (case-insensitive) — the IMAP-advertised
 * canonical flag — and ignores name-based heuristics so a user's custom
 * folder called "Trash" in a non-English locale doesn't accidentally
 * satisfy the check.
 *
 * Returns `null` when no Trash folder is advertised (the caller should
 * fall back to a permanent-delete prompt in that case).
 */
export function findTrashFolderIdForAccount(
  folders: Folder[],
  accountId: string
): string | null {
  const candidates = folders.filter((folder) => folder.accountId === accountId);
  const bySpecialUse = candidates.find(
    // Trim before lowercasing to match `lib/specialFolders.ts`'s `normalize()`
    // — IMAP-sourced `specialUse` values can include stray whitespace.
    (folder) => (folder.specialUse ?? "").trim().toLowerCase() === "\\trash"
  );
  return bySpecialUse?.id ?? null;
}

/**
 * Determine whether deleting `target` should be treated as *permanent*
 * rather than a move-to-trash — i.e. the user needs to see the
 * destructive-confirm dialog.
 *
 * A delete is permanent when the message is already in the Trash folder:
 * either the resolved `trashFolderId` for the account, or any folder
 * that the caller-supplied `isTrashFolder` predicate considers a trash
 * folder (covers the cross-account "all scope" case where each account
 * has its own Trash).
 */
export function isPermanentDeleteTarget(
  target: Pick<Message, "folderId">,
  trashFolderId: string | null,
  isTrashFolder: (folderId?: string | null) => boolean
): boolean {
  if (trashFolderId && target.folderId === trashFolderId) return true;
  return isTrashFolder(target.folderId);
}
