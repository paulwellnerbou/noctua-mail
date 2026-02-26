type ThreadingItem = {
  id: string;
  dateValue: number;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: readonly string[] | null;
  threadId?: string | null;
};

type ThreadingResolutionOptions = {
  externalThreadIds?: ReadonlyMap<string, string>;
  externalParentIds?: ReadonlyMap<string, string>;
};

type PreparedThreadingItem<T extends ThreadingItem> = {
  item: T;
  normalizedMessageId: string | null;
  normalizedInReplyTo: string | null;
  normalizedReferences: string[];
};

function normalizeHeaderId(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeReferenceIds(values?: readonly string[] | null) {
  if (!values || values.length === 0) return [];
  const normalized: string[] = [];
  values.forEach((value) => {
    const next = normalizeHeaderId(value);
    if (next) normalized.push(next);
  });
  return normalized;
}

export function collectThreadReferenceIds(
  items: Iterable<Pick<ThreadingItem, "inReplyTo" | "references">>
) {
  const ids = new Set<string>();
  for (const item of items) {
    const inReplyTo = normalizeHeaderId(item.inReplyTo);
    if (inReplyTo) ids.add(inReplyTo);
    normalizeReferenceIds(item.references).forEach((ref) => ids.add(ref));
  }
  return Array.from(ids);
}

export function resolveThreadingForItems<T extends ThreadingItem>(
  items: readonly T[],
  options: ThreadingResolutionOptions = {}
) {
  if (items.length === 0) {
    return [] as Array<T & { threadId: string; parentId?: string }>;
  }
  const externalThreadIds = options.externalThreadIds ?? new Map<string, string>();
  const externalParentIds = options.externalParentIds ?? new Map<string, string>();
  const prepared: Array<PreparedThreadingItem<T>> = items.map((item) => ({
    item,
    normalizedMessageId: normalizeHeaderId(item.messageId),
    normalizedInReplyTo: normalizeHeaderId(item.inReplyTo),
    normalizedReferences: normalizeReferenceIds(item.references)
  }));
  const byMessageId = new Map<string, PreparedThreadingItem<T>>();
  prepared.forEach((entry) => {
    if (!entry.normalizedMessageId) return;
    const existing = byMessageId.get(entry.normalizedMessageId);
    if (!existing || entry.item.dateValue < existing.item.dateValue) {
      byMessageId.set(entry.normalizedMessageId, entry);
    }
  });
  const parentCache = new Map<string, string | null>();
  const findLocalParent = (entry: PreparedThreadingItem<T>) => {
    if (entry.normalizedInReplyTo) {
      const parent = byMessageId.get(entry.normalizedInReplyTo);
      if (parent) return parent;
    }
    for (let i = entry.normalizedReferences.length - 1; i >= 0; i -= 1) {
      const parent = byMessageId.get(entry.normalizedReferences[i]);
      if (parent) return parent;
    }
    return null;
  };
  const resolveParentId = (entry: PreparedThreadingItem<T>) => {
    if (parentCache.has(entry.item.id)) return parentCache.get(entry.item.id)!;
    let resolved: string | null = null;
    const localParent = findLocalParent(entry);
    if (localParent) {
      resolved = localParent.item.id;
    } else if (entry.normalizedInReplyTo) {
      const external = externalParentIds.get(entry.normalizedInReplyTo);
      if (external) resolved = external;
    }
    if (!resolved) {
      for (let i = entry.normalizedReferences.length - 1; i >= 0; i -= 1) {
        const external = externalParentIds.get(entry.normalizedReferences[i]);
        if (external) {
          resolved = external;
          break;
        }
      }
    }
    if (resolved === entry.item.id) {
      resolved = null;
    }
    parentCache.set(entry.item.id, resolved);
    return resolved;
  };
  const threadCache = new Map<string, string>();
  const resolveThreadId = (entry: PreparedThreadingItem<T>, stack: Set<string>): string => {
    const cached = threadCache.get(entry.item.id);
    if (cached) return cached;
    if (stack.has(entry.item.id)) {
      const fallback =
        entry.normalizedMessageId ??
        normalizeHeaderId(entry.item.threadId) ??
        entry.item.id;
      threadCache.set(entry.item.id, fallback);
      return fallback;
    }
    stack.add(entry.item.id);
    let resolved: string | null = null;
    const localParent = findLocalParent(entry);
    if (localParent) {
      resolved = resolveThreadId(localParent, stack);
    }
    if (!resolved && entry.normalizedInReplyTo) {
      resolved = externalThreadIds.get(entry.normalizedInReplyTo) ?? null;
    }
    if (!resolved) {
      for (const ref of entry.normalizedReferences) {
        const external = externalThreadIds.get(ref);
        if (external) {
          resolved = external;
          break;
        }
      }
    }
    if (!resolved) {
      resolved =
        entry.normalizedInReplyTo ??
        entry.normalizedReferences[entry.normalizedReferences.length - 1] ??
        entry.normalizedMessageId ??
        normalizeHeaderId(entry.item.threadId) ??
        entry.item.id;
    }
    stack.delete(entry.item.id);
    threadCache.set(entry.item.id, resolved);
    return resolved;
  };
  return prepared.map((entry) => ({
    ...entry.item,
    threadId: resolveThreadId(entry, new Set()),
    parentId: resolveParentId(entry) ?? undefined
  }));
}
