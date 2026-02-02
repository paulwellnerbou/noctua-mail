import { Badge } from "@radix-ui/themes";
import { Folder } from "lucide-react";
import { badgeColors } from "@/lib/ui/badgeColors";
import styles from "./FolderBadges.module.css";

type FolderBadgesProps = {
  folderIds: string[];
  folderNameById: (id: string) => string;
  threadPathById: (id: string) => string;
  onSelectFolder: (id: string) => void;
};

export default function FolderBadges({
  folderIds,
  folderNameById,
  threadPathById,
  onSelectFolder
}: FolderBadgesProps) {
  if (folderIds.length === 0) return null;
  return (
    <span className={styles.badges}>
      {folderIds.map((folderId) => (
        <Badge key={folderId} size="1" variant="soft" color={badgeColors.folder} asChild>
          <button
            type="button"
            title={threadPathById(folderId)}
            className={styles.badgeButton}
            onClick={(event) => {
              event.stopPropagation();
              onSelectFolder(folderId);
            }}
          >
            <Folder size={12} />
            {folderNameById(folderId)}
          </button>
        </Badge>
      ))}
    </span>
  );
}
