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
    <span className="folder-badges">
      {folderIds.map((folderId) => (
        <button
          key={folderId}
          className="folder-badge"
          title={threadPathById(folderId)}
          onClick={(event) => {
            event.stopPropagation();
            onSelectFolder(folderId);
          }}
        >
          {folderNameById(folderId)}
        </button>
      ))}
    </span>
  );
}
