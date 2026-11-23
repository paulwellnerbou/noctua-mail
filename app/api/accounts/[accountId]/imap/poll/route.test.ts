import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account } from "@/lib/data";
import { sealSession } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";

const { upsertAccount } = await dbModulePromise;
const { GET } = await import("./route");

// Nothing listens on the IMAP port: an authorized request ends at the refused
// connection, a rejected one never gets that far.
function buildAccount(id: string, ownerUserId: string): Account {
  const email = `${id}@example.test`;
  return {
    id,
    name: "Poll Test Account",
    email,
    avatar: "",
    ownerUserId,
    imap: { host: "127.0.0.1", port: 1, secure: false, user: email, password: "secret-imap" },
    smtp: { host: "127.0.0.1", port: 1, secure: false, user: email, password: "secret-smtp" }
  };
}

function poll(accountId: string, session?: { userId: string; accountId: string }) {
  const headers = new Headers();
  if (session) {
    const sealed = sealSession({ ...session, exp: Math.floor(Date.now() / 1000) + 3600 });
    headers.set("cookie", `noctua_session=${encodeURIComponent(sealed)}`);
  }
  return GET(
    new Request(`http://localhost/api/accounts/${accountId}/imap/poll?statusOnly=1`, { headers }),
    { params: Promise.resolve({ accountId }) }
  );
}

/**
 * How far the request got. Anything past authorization is the IMAP layer's
 * answer, which other suites in the same process replace with fakes that may
 * throw, so it is reported as one outcome instead of a status.
 */
async function pollOutcome(accountId: string, session?: { userId: string; accountId: string }) {
  try {
    const { status } = await poll(accountId, session);
    return status === 401 || status === 403 ? status : "reached-imap";
  } catch {
    return "reached-imap";
  }
}

async function seedTwoUsers() {
  const suffix = randomUUID();
  const userId = `user-poll-${suffix}`;
  const active = `acc-poll-active-${suffix}`;
  const other = `acc-poll-other-${suffix}`;
  const foreign = `acc-poll-foreign-${suffix}`;
  await upsertAccount(buildAccount(active, userId));
  await upsertAccount(buildAccount(other, userId));
  await upsertAccount(buildAccount(foreign, `user-poll-stranger-${suffix}`));
  return { session: { userId, accountId: active }, active, other, foreign };
}

describe("imap poll route authorization", () => {
  test("lets the user poll an account of theirs that is not the active one", async () => {
    const { session, other } = await seedTwoUsers();
    expect(await pollOutcome(other, session)).toBe("reached-imap");
  });

  test("still serves the active account", async () => {
    const { session, active } = await seedTwoUsers();
    expect(await pollOutcome(active, session)).toBe("reached-imap");
  });

  test("rejects an account of another user", async () => {
    const { session, foreign } = await seedTwoUsers();
    expect(await pollOutcome(foreign, session)).toBe(403);
  });

  test("rejects a request without a session", async () => {
    const { other } = await seedTwoUsers();
    expect(await pollOutcome(other)).toBe(401);
  });
});
