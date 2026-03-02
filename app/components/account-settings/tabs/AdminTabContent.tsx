import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Card, Flex, IconButton, Text } from "@radix-ui/themes";

export type AdminUserDirectoryAccount = {
  id: string;
  name: string;
  email: string;
  ownerUserId?: string;
};

export type AdminUserDirectoryEntry = {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: number;
  accounts: AdminUserDirectoryAccount[];
};

type AdminInviteEntry = {
  code: string;
  role: "admin" | "user";
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
  usedByUserId?: string | null;
  usedByUserEmail?: string | null;
  isUsed: boolean;
};

type AdminUsersResponse = {
  ok?: boolean;
  users?: AdminUserDirectoryEntry[];
  message?: string;
};

type AdminInvitesResponse = {
  ok?: boolean;
  invites?: AdminInviteEntry[];
  message?: string;
};

type AdminInviteCreateResponse = {
  ok?: boolean;
  invite?: { code?: string };
  message?: string;
};

type Props = {
  isActive: boolean;
  isAdminUser: boolean;
  onClose: () => void;
  onInviteGenerated?: () => void;
  apiFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage?: (res: Response) => Promise<string>;
};

function formatTimestamp(value?: number | null) {
  if (value === null) return "Never";
  if (!value || !Number.isFinite(value)) return "Unknown";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown";
  }
}

export default function AdminTabContent({
  isActive,
  isAdminUser,
  onClose,
  onInviteGenerated,
  apiFetch,
  readErrorMessage
}: Props) {
  const [users, setUsers] = useState<AdminUserDirectoryEntry[]>([]);
  const [invites, setInvites] = useState<AdminInviteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestGeneratedInviteCode, setLatestGeneratedInviteCode] = useState<string | null>(null);
  const [generatingInviteCode, setGeneratingInviteCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const request = apiFetch ?? fetch;
  const readError = useMemo(
    () =>
      readErrorMessage ??
      (async (res: Response) => {
        try {
          const data = (await res.json()) as { message?: string; error?: string };
          return data?.message || data?.error || `Request failed (${res.status})`;
        } catch {
          return `Request failed (${res.status})`;
        }
      }),
    [readErrorMessage]
  );

  const loadAdminData = useCallback(async () => {
    if (!isAdminUser) {
      setUsers([]);
      setInvites([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [usersRes, invitesRes] = await Promise.all([
        request("/api/admin/users", { cache: "no-store" }),
        request("/api/admin/invites", { cache: "no-store" })
      ]);

      if (!usersRes.ok) {
        setError(await readError(usersRes));
        return;
      }
      if (!invitesRes.ok) {
        setError(await readError(invitesRes));
        return;
      }

      const usersData = (await usersRes.json()) as AdminUsersResponse;
      const invitesData = (await invitesRes.json()) as AdminInvitesResponse;

      if (!usersData?.ok || !Array.isArray(usersData.users)) {
        setError(usersData?.message || "Invalid admin users response.");
        return;
      }
      if (!invitesData?.ok || !Array.isArray(invitesData.invites)) {
        setError(invitesData?.message || "Invalid admin invites response.");
        return;
      }

      setUsers(usersData.users);
      setInvites(invitesData.invites);
    } catch {
      setError("Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  }, [isAdminUser, readError, request]);

  const generateInviteCode = useCallback(async () => {
    if (!isAdminUser) return;
    setGeneratingInviteCode(true);
    setError(null);
    try {
      const res = await request("/api/admin/invites", { method: "POST" });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const data = (await res.json()) as AdminInviteCreateResponse;
      const inviteCode = data?.invite?.code?.trim() ?? "";
      if (!data?.ok || !inviteCode) {
        setError(data?.message || "Failed to generate invite code.");
        return;
      }
      setLatestGeneratedInviteCode(inviteCode);
      onInviteGenerated?.();
      await loadAdminData();
    } catch {
      setError("Failed to generate invite code.");
    } finally {
      setGeneratingInviteCode(false);
    }
  }, [isAdminUser, loadAdminData, onInviteGenerated, readError, request]);

  const copyInviteCode = useCallback(async (code: string) => {
    const normalized = code.trim();
    if (!normalized) return;
    try {
      await navigator.clipboard.writeText(normalized);
      setCopiedCode(normalized);
      window.setTimeout(() => {
        setCopiedCode((current) => (current === normalized ? null : current));
      }, 1400);
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    if (!isActive || !isAdminUser) return;
    void loadAdminData();
  }, [isActive, isAdminUser, loadAdminData]);

  useEffect(() => {
    if (isAdminUser) return;
    setUsers([]);
    setInvites([]);
    setError(null);
    setLatestGeneratedInviteCode(null);
    setGeneratingInviteCode(false);
    setCopiedCode(null);
  }, [isAdminUser]);

  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between" gap="3" wrap="wrap">
            <Text size="2" color="gray">
              Generate invite codes, review invite usage, and inspect users with linked accounts.
            </Text>
            <Flex align="center" gap="2" wrap="wrap">
              <Button
                size="1"
                variant="soft"
                onClick={() => void loadAdminData()}
                disabled={loading || generatingInviteCode}
              >
                {loading ? "Refreshing..." : "Refresh"}
              </Button>
              <Button
                size="1"
                onClick={() => void generateInviteCode()}
                disabled={generatingInviteCode || loading}
              >
                {generatingInviteCode ? "Generating..." : "Generate invite code"}
              </Button>
            </Flex>
          </Flex>

          {error && (
            <Card size="2">
              <Text size="2" color="red">
                {error}
              </Text>
            </Card>
          )}

          {latestGeneratedInviteCode && (
            <Card size="2">
              <Flex direction="column" gap="1">
                <Text size="2" color="gray">
                  Latest generated invite code
                </Text>
                <Flex align="center" gap="2" wrap="wrap">
                  <Text size="2" weight="bold" style={{ overflowWrap: "anywhere" }}>
                    {latestGeneratedInviteCode}
                  </Text>
                  <IconButton
                    size="1"
                    variant="soft"
                    color="gray"
                    aria-label="Copy invite code"
                    title="Copy invite code"
                    onClick={() => void copyInviteCode(latestGeneratedInviteCode)}
                  >
                    {copiedCode === latestGeneratedInviteCode ? <Check size={14} /> : <Copy size={14} />}
                  </IconButton>
                </Flex>
              </Flex>
            </Card>
          )}

          <Card size="2">
            <Flex direction="column" gap="2">
              <Text size="3" weight="medium">
                Users
              </Text>
              {users.length === 0 ? (
                <Text size="2" color="gray">
                  {loading ? "Loading users..." : "No users found."}
                </Text>
              ) : (
                <Flex direction="column" gap="3">
                  {users.map((user) => (
                    <Card key={user.id} size="1">
                      <Flex direction="column" gap="2">
                        <Text size="3" weight="medium">
                          {user.email}
                        </Text>
                        <Text size="2" color="gray">
                          Role: {user.role} · Created: {user.createdAt ? new Date(user.createdAt).toLocaleString() : "Unknown"}
                        </Text>
                        <Text size="1" color="gray" style={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>
                          User ID: {user.id}
                        </Text>
                        {user.accounts.length === 0 ? (
                          <Text size="2" color="gray">
                            No linked accounts.
                          </Text>
                        ) : (
                          <Flex direction="column" gap="1">
                            {user.accounts.map((account) => (
                              <Flex key={account.id} direction="column" gap="0">
                                <Text size="2">
                                  {account.name || account.email} ({account.email})
                                </Text>
                                <Text size="1" color="gray" style={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>
                                  Account ID: {account.id}
                                </Text>
                              </Flex>
                            ))}
                          </Flex>
                        )}
                      </Flex>
                    </Card>
                  ))}
                </Flex>
              )}
            </Flex>
          </Card>

          <Card size="2">
            <Flex direction="column" gap="2">
              <Text size="3" weight="medium">
                Invite codes
              </Text>
              {invites.length === 0 ? (
                <Text size="2" color="gray">
                  {loading ? "Loading invite codes..." : "No invite codes found."}
                </Text>
              ) : (
                <Flex direction="column" gap="2">
                  {invites.map((invite) => {
                    const usedByText = invite.isUsed
                      ? invite.usedByUserEmail || invite.usedByUserId || "Unknown user"
                      : "Not used";
                    const statusText = invite.isUsed ? "Used" : "Unused";
                    return (
                      <Card key={invite.code} size="1">
                        <Flex direction="column" gap="1">
                          <Flex align="center" gap="2" wrap="wrap" justify="between">
                            <Flex align="center" gap="2" wrap="wrap">
                              <Text size="2" weight="medium" style={{ overflowWrap: "anywhere" }}>
                                {invite.code}
                              </Text>
                              <IconButton
                                size="1"
                                variant="soft"
                                color="gray"
                                aria-label="Copy invite code"
                                title="Copy invite code"
                                onClick={() => void copyInviteCode(invite.code)}
                              >
                                {copiedCode === invite.code ? <Check size={14} /> : <Copy size={14} />}
                              </IconButton>
                            </Flex>
                            <Text size="1" color={invite.isUsed ? "green" : "gray"}>
                              {statusText}
                            </Text>
                          </Flex>
                          <Text size="1" color="gray">
                            Role: {invite.role} · Uses: {invite.uses}
                            {invite.maxUses === null ? "" : `/${invite.maxUses}`}
                          </Text>
                          <Text size="1" color="gray">
                            Used by: {usedByText}
                          </Text>
                          <Text size="1" color="gray">
                            Created: {formatTimestamp(invite.createdAt)} · Expires: {formatTimestamp(invite.expiresAt)}
                          </Text>
                        </Flex>
                      </Card>
                    );
                  })}
                </Flex>
              )}
            </Flex>
          </Card>
        </Flex>
      </div>

      <Flex
        justify="end"
        align="center"
        gap="3"
        wrap="wrap"
        style={{ paddingTop: "var(--space-3)", borderTop: "1px solid var(--gray-a5)" }}
      >
        <Button size="2" variant="soft" color="gray" onClick={onClose}>
          Close
        </Button>
      </Flex>
    </Flex>
  );
}
