import { Badge } from "@radix-ui/themes";
import { Archive, FileText, Folder, Inbox, Send, ShieldOff, Trash2 } from "lucide-react";
import type { Folder as MailFolder } from "@/lib/data";
import { badgeColors } from "@/lib/ui/badgeColors";
import { getFolderBadgeKind, getFolderBadgeLabel } from "./folderBadgePresentation";
import styles from "./FolderBadges.module.css";

type FolderBadgesProps = {
  folderIds: string[];
  folderById: (id: string) => MailFolder | undefined;
  threadPathById: (id: string) => string;
  onSelectFolder: (id: string) => void;
};

export default function FolderBadges({
  folderIds,
  folderById,
  threadPathById,
  onSelectFolder
}: FolderBadgesProps) {
  if (folderIds.length === 0) return null;
  return (
    <span className={styles.badges}>
      {folderIds.map((folderId) => {
        const folder = folderById(folderId);
        const label = getFolderBadgeLabel(folder, folderId);
        const kind = getFolderBadgeKind(folder);
        const name = folder?.name ?? folderId;

        return (
          <Badge key={folderId} size="1" variant="soft" color={badgeColors.folder} asChild>
            <button
              type="button"
              title={threadPathById(folderId)}
              aria-label={name}
              className={styles.badgeButton}
              onClick={(event) => {
                event.stopPropagation();
                onSelectFolder(folderId);
              }}
            >
              {kind === "inbox" ? <Inbox size={12} /> :
               kind === "sent" ? <Send size={12} /> :
               kind === "drafts" ? <FileText size={12} /> :
               kind === "trash" ? <Trash2 size={12} /> :
               kind === "spam" ? <ShieldOff size={12} /> :
               kind === "archive" ? <Archive size={12} /> :
               <Folder size={12} />}
              {label ? <span className={styles.badgeLabel}>{label}</span> : null}
            </button>
          </Badge>
        );
      })}
    </span>
  );
}
