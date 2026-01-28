type StreamControl = {
  removeFolder: (folderId: string) => void | Promise<void>;
};

const streamsByAccount = new Map<string, Set<StreamControl>>();

export function registerStream(accountId: string, control: StreamControl) {
  const existing = streamsByAccount.get(accountId) ?? new Set<StreamControl>();
  existing.add(control);
  streamsByAccount.set(accountId, existing);
  return () => {
    const bucket = streamsByAccount.get(accountId);
    if (!bucket) return;
    bucket.delete(control);
    if (bucket.size === 0) {
      streamsByAccount.delete(accountId);
    }
  };
}

export async function notifyFolderDeleted(accountId: string, folderId: string) {
  const bucket = streamsByAccount.get(accountId);
  if (!bucket || bucket.size === 0) return;
  await Promise.all(
    Array.from(bucket.values()).map(async (control) => {
      await control.removeFolder(folderId);
    })
  );
}
