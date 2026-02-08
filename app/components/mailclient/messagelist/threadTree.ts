import type { Message } from "@/lib/data";

export type ThreadNode = { message: Message; children: ThreadNode[]; threadSize: number };

export function buildThreadTree(items: Message[]) {
  const buckets = new Map<string, Message[]>();
  items.forEach((message) => {
    const key = message.threadId ?? message.id;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(message);
  });
  const allRoots: ThreadNode[] = [];
  const sortNodes = (list: ThreadNode[]) => {
    list.sort((a, b) => a.message.dateValue - b.message.dateValue);
    list.forEach((child) => sortNodes(child.children));
  };
  buckets.forEach((bucket) => {
    const nodes = new Map<string, ThreadNode>();
    bucket.forEach((message) => {
      nodes.set(message.id, { message, children: [], threadSize: bucket.length });
    });
    const roots: ThreadNode[] = [];
    const findParentId = (message: Message) => {
      const parentId = message.parentId;
      if (!parentId) return null;
      return nodes.has(parentId) ? parentId : null;
    };
    bucket.forEach((message) => {
      const node = nodes.get(message.id);
      if (!node) return;
      const parentId = findParentId(message);
      if (parentId && parentId !== message.id) {
        nodes.get(parentId)!.children.push(node);
        return;
      }
      roots.push(node);
    });
    if (roots.length > 1) {
      const sorted = [...roots].sort((a, b) => {
        if (a.message.dateValue !== b.message.dateValue) {
          return a.message.dateValue - b.message.dateValue;
        }
        return a.message.id.localeCompare(b.message.id);
      });
      const root = sorted[0];
      // Keep one UI thread per threadId by attaching disconnected roots under the oldest root.
      root.children.push(...sorted.slice(1));
      roots.length = 0;
      roots.push(root);
    }
    sortNodes(roots);
    roots.forEach((root) => allRoots.push(root));
  });
  return allRoots;
}

export function getThreadLatestDate(node: ThreadNode) {
  let latest = node.message.dateValue;
  node.children.forEach((child) => {
    const childLatest = getThreadLatestDate(child);
    if (childLatest > latest) latest = childLatest;
  });
  return latest;
}

export function flattenThread(node: ThreadNode, depth = 0, visited = new Set<string>()) {
  if (visited.has(node.message.id)) {
    return [];
  }
  visited.add(node.message.id);
  const items: { message: Message; depth: number }[] = [{ message: node.message, depth }];
  node.children.forEach((child) => {
    items.push(...flattenThread(child, depth + 1, visited));
  });
  return items;
}
