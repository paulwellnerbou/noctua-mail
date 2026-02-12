type LoadedCountParams = {
  page: number;
  previousCount: number;
  itemCount: number;
  baseCount?: number;
};

function resolvePageCount(itemCount: number, baseCount?: number) {
  if (typeof baseCount === "number" && Number.isFinite(baseCount) && baseCount >= 0) {
    return baseCount;
  }
  return itemCount;
}

export function mergeLoadedMessageCount({
  page,
  previousCount,
  itemCount,
  baseCount
}: LoadedCountParams) {
  const pageCount = resolvePageCount(itemCount, baseCount);
  if (page <= 1) return pageCount;
  return previousCount + pageCount;
}

export function resolveLoadedMessageCount(itemCount: number, baseCount?: number) {
  return resolvePageCount(itemCount, baseCount);
}
