import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account } from "@/lib/data";
import {
  hashOpaqueToken,
  sealSession,
  unsealMcpSession,
  type SessionData
} from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";
import { shouldIncludeSessionCredentials } from "@/lib/secret";

const { getMcpTokenByHash, listMcpTokens, upsertAccount } = await dbModulePromise;

const { DELETE } = await import("./[tokenId]/route");
const { GET, POST } = await import("./route");

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "MCP Test Account",
    email: "owner@example.test",
    avatar: "",
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "secret-imap"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "secret-smtp"
    }
  };
}

function buildSession(accountId: string, includeCredentials: boolean): SessionData {
  return {
    userId: "user-mcp-tests",
    accountId,
    role: "user",
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    ...(includeCredentials
      ? {
          imap: { user: "owner@example.test", pass: "secret-imap" },
          smtp: { user: "owner@example.test", pass: "secret-smtp" }
        }
      : {})
  };
}

function buildCookieHeader(session: SessionData) {
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describe("account MCP token routes", () => {
  test("creates, lists, stores, and deletes hashed MCP tokens", async () => {
    const accountId = uniqueAccountId("acc-mcp-token-crud");
    await upsertAccount(buildAccount(accountId));

    const expiresAt = Date.now() + 90 * 24 * 60 * 60 * 1000;
    const createResponse = await POST(
      new Request(`http://localhost/api/accounts/${accountId}/mcp-tokens`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: buildCookieHeader(buildSession(accountId, true))
        },
        body: JSON.stringify({
          label: "Claude Desktop",
          expiresAt
        })
      }),
      { params: Promise.resolve({ id: accountId }) }
    );

    expect(createResponse.status).toBe(201);
    const createBody = (await createResponse.json()) as {
      ok?: boolean;
      token?: { id: string; label: string; expiresAt: number | null };
      secret?: string;
    };
    expect(createBody.ok).toBe(true);
    expect(createBody.token?.label).toBe("Claude Desktop");
    expect(createBody.token?.expiresAt).toBe(expiresAt);
    expect(createBody.secret?.startsWith("mcp_")).toBe(true);

    const stored = await getMcpTokenByHash(hashOpaqueToken(createBody.secret!));
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).not.toBe(createBody.secret);
    expect(stored?.tokenSuffix).toBe(createBody.secret!.slice(-8));

    const sealedPayload = unsealMcpSession(createBody.secret!);
    expect(sealedPayload?.accountId).toBe(accountId);
    expect(sealedPayload?.tokenId).toBe(createBody.token?.id);
    if (shouldIncludeSessionCredentials()) {
      expect(sealedPayload?.imap).toEqual({ user: "owner@example.test", pass: "secret-imap" });
      expect(sealedPayload?.smtp).toEqual({ user: "owner@example.test", pass: "secret-smtp" });
    } else {
      expect(sealedPayload?.imap).toBeUndefined();
      expect(sealedPayload?.smtp).toBeUndefined();
    }

    const listResponse = await GET(
      new Request(`http://localhost/api/accounts/${accountId}/mcp-tokens`, {
        headers: {
          cookie: buildCookieHeader(buildSession(accountId, true))
        }
      }),
      { params: Promise.resolve({ id: accountId }) }
    );
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as {
      ok?: boolean;
      tokens?: Array<{ id: string; label: string }>;
      secret?: string;
    };
    expect(listBody.ok).toBe(true);
    expect(listBody.tokens?.map((token) => token.label)).toEqual(["Claude Desktop"]);
    expect(listBody.secret).toBeUndefined();

    const deletedResponse = await DELETE(
      new Request(`http://localhost/api/accounts/${accountId}/mcp-tokens/${createBody.token!.id}`, {
        method: "DELETE",
        headers: {
          cookie: buildCookieHeader(buildSession(accountId, true))
        }
      }),
      { params: Promise.resolve({ id: accountId, tokenId: createBody.token!.id }) }
    );
    expect(deletedResponse.status).toBe(200);
    expect(await listMcpTokens(accountId)).toEqual([]);
  });

  test("rejects token creation when session credentials are required but missing", async () => {
    if (!shouldIncludeSessionCredentials()) {
      return;
    }

    const accountId = uniqueAccountId("acc-mcp-no-creds");
    await upsertAccount(buildAccount(accountId));

    const response = await POST(
      new Request(`http://localhost/api/accounts/${accountId}/mcp-tokens`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: buildCookieHeader(buildSession(accountId, false))
        },
        body: JSON.stringify({
          label: "Broken Token",
          expiresAt: Date.now() + 60 * 60 * 1000
        })
      }),
      { params: Promise.resolve({ id: accountId }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok?: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain("IMAP/SMTP credentials");
  });
});
