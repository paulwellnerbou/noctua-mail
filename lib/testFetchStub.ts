type FetchHandler = (...args: Parameters<typeof fetch>) => Promise<Response>;

/**
 * Bun's `typeof fetch` also carries `fetch.preconnect`, so a bare async
 * function cannot stand in for the global. Tests install stubs through this
 * helper instead of casting.
 */
export function createFetchStub(handler: FetchHandler): typeof fetch {
  return Object.assign(handler, { preconnect: () => undefined });
}
