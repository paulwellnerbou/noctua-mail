"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Badge, Button, Card, Flex, IconButton, Select, Text, TextField } from "@radix-ui/themes";
import {
  buildAccountMcpTokenPath,
  buildAccountMcpTokensPath
} from "@/lib/accountApiPaths";
import type { AccountDateFormat, McpTokenMetadata } from "@/lib/data";
import { formatAccountTimestampLabel } from "@/lib/dateFormatting";

type Props = {
  accountId?: string;
  isActive: boolean;
  isExistingAccount: boolean;
  accountDateFormat?: AccountDateFormat;
  apiFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
};

type CreateTokenResponse = {
  ok?: boolean;
  token?: McpTokenMetadata;
  secret?: string;
  message?: string;
};

type ListTokensResponse = {
  ok?: boolean;
  tokens?: McpTokenMetadata[];
  message?: string;
};

const EXPIRY_PRESETS = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "180d", label: "180 days" },
  { value: "never", label: "Never" },
  { value: "custom", label: "Custom" }
] as const;

function formatTimestamp(value: number | null, accountDateFormat?: AccountDateFormat) {
  return formatAccountTimestampLabel(value, accountDateFormat);
}

function toDateTimeLocalValue(value: number) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function expiryFromPreset(
  preset: (typeof EXPIRY_PRESETS)[number]["value"],
  customDateTime: string
) {
  if (preset === "never") return null;
  if (preset === "custom") {
    return customDateTime ? new Date(customDateTime).getTime() : Number.NaN;
  }
  const days = Number.parseInt(preset, 10);
  if (!Number.isFinite(days) || days <= 0) return Number.NaN;
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

export default function McpTabContent({
  accountId,
  isActive,
  isExistingAccount,
  accountDateFormat,
  apiFetch,
  onClose
}: Props) {
  const request = apiFetch ?? fetch;
  const [tokens, setTokens] = useState<McpTokenMetadata[]>([]);
  const [label, setLabel] = useState("");
  const [expiryPreset, setExpiryPreset] = useState<(typeof EXPIRY_PRESETS)[number]["value"]>("180d");
  const [customExpiresAt, setCustomExpiresAt] = useState(() =>
    toDateTimeLocalValue(Date.now() + 180 * 24 * 60 * 60 * 1000)
  );
  const [createdSecret, setCreatedSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [error, setError] = useState("");
  const copyResetTimerRef = useRef<number | null>(null);
  const serverUrl = useMemo(() => {
    if (typeof window === "undefined") return "/api/mcp";
    return `${window.location.origin}/api/mcp`;
  }, []);

  const readError = useCallback(async (response: Response) => {
    const data = (await response.json().catch(() => null)) as { message?: string } | null;
    return data?.message ?? `Request failed (${response.status})`;
  }, []);

  const loadTokens = useCallback(async () => {
    if (!accountId) {
      setTokens([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await request(buildAccountMcpTokensPath(accountId), { cache: "no-store" });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const data = (await response.json()) as ListTokensResponse;
      setTokens(data.ok && Array.isArray(data.tokens) ? data.tokens : []);
    } catch {
      setError("Failed to load MCP tokens.");
    } finally {
      setLoading(false);
    }
  }, [accountId, readError, request]);

  useEffect(() => {
    if (isActive && isExistingAccount) {
      void loadTokens();
    }
  }, [isActive, isExistingAccount, loadTokens]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    try {
      await navigator.clipboard.writeText(normalized);
      setCopiedValue(normalized);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedValue((current) => (current === normalized ? null : current));
        copyResetTimerRef.current = null;
      }, 1200);
    } catch {
      // ignore
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!accountId) return;
    setCreating(true);
    setError("");
    setCreatedSecret("");
    try {
      const expiresAt = expiryFromPreset(expiryPreset, customExpiresAt);
      if (Number.isNaN(expiresAt)) {
        setError("Choose a valid token expiry.");
        return;
      }
      const response = await request(buildAccountMcpTokensPath(accountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          expiresAt
        })
      });
      const data = (await response.json().catch(() => null)) as CreateTokenResponse | null;
      if (!response.ok || !data?.ok || !data.token || !data.secret) {
        setError(data?.message ?? "Failed to create MCP token.");
        return;
      }
      setTokens((current) => [data.token!, ...current.filter((item) => item.id !== data.token!.id)]);
      setCreatedSecret(data.secret);
      setLabel("");
      setExpiryPreset("180d");
      setCustomExpiresAt(toDateTimeLocalValue(Date.now() + 180 * 24 * 60 * 60 * 1000));
    } catch {
      setError("Failed to create MCP token.");
    } finally {
      setCreating(false);
    }
  }, [accountId, customExpiresAt, expiryPreset, label, request]);

  const handleDelete = useCallback(async (tokenId: string) => {
    if (!accountId) return;
    const confirmed = window.confirm("Delete this MCP token?");
    if (!confirmed) return;
    setDeletingId(tokenId);
    setError("");
    try {
      const response = await request(buildAccountMcpTokenPath(accountId, tokenId), {
        method: "DELETE"
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setTokens((current) => current.filter((item) => item.id !== tokenId));
    } catch {
      setError("Failed to delete MCP token.");
    } finally {
      setDeletingId("");
    }
  }, [accountId, readError, request]);

  if (!isExistingAccount) {
    return null;
  }

  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "var(--space-2)" }}>
        <Card>
          <Flex direction="column" gap="3">
            <Text size="3" weight="medium">MCP server</Text>
            <Text size="2" color="gray">
              Use the MCP endpoint below with an <code>Authorization: Bearer &lt;token&gt;</code> header.
            </Text>
            <Flex align="center" gap="2" wrap="wrap">
              <Text size="2" style={{ fontFamily: "var(--default-mono-font-family)" }}>
                {serverUrl}
              </Text>
              <IconButton
                size="1"
                variant="soft"
                onClick={() => void handleCopy(serverUrl)}
                aria-label={copiedValue === serverUrl ? "Copied server URL" : "Copy server URL"}
                title={copiedValue === serverUrl ? "Copied server URL" : "Copy server URL"}
              >
                {copiedValue === serverUrl ? <Check size={14} /> : <Copy size={14} />}
              </IconButton>
            </Flex>
          </Flex>
        </Card>

        <Card style={{ marginTop: "var(--space-4)" }}>
          <Flex direction="column" gap="3">
            <Text size="3" weight="medium">Create token</Text>
            <Flex direction="column" gap="2">
              <Text size="2" color="gray">Label</Text>
              <TextField.Root
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="My MCP client"
              />
            </Flex>
            <Flex direction="column" gap="2">
              <Text size="2" color="gray">Expiry</Text>
              <Select.Root value={expiryPreset} onValueChange={(value) => setExpiryPreset(value as typeof expiryPreset)}>
                <Select.Trigger />
                <Select.Content>
                  {EXPIRY_PRESETS.map((preset) => (
                    <Select.Item key={preset.value} value={preset.value}>
                      {preset.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            {expiryPreset === "custom" && (
              <Flex direction="column" gap="2">
                <Text size="2" color="gray">Custom expiry</Text>
                <TextField.Root
                  type="datetime-local"
                  value={customExpiresAt}
                  onChange={(event) => setCustomExpiresAt(event.target.value)}
                />
              </Flex>
            )}
            <Flex align="center" gap="2" wrap="wrap">
              <Button
                onClick={() => void handleCreate()}
                disabled={!accountId || !label.trim() || creating}
              >
                {creating ? "Creating..." : "Create token"}
              </Button>
              <Text size="1" color="gray">
                The token secret is shown once and cannot be retrieved later.
              </Text>
            </Flex>
            {createdSecret && (
              <Card variant="surface">
                <Flex direction="column" gap="2">
                  <Text size="2" weight="medium">New token</Text>
                  <Text size="1" color="gray">
                    Copy this now. It will not be shown again.
                  </Text>
                  <Text
                    size="1"
                    style={{
                      fontFamily: "var(--default-mono-font-family)",
                      overflowWrap: "anywhere"
                    }}
                  >
                    {createdSecret}
                  </Text>
                  <Flex>
                    <IconButton
                      size="1"
                      variant="soft"
                      onClick={() => void handleCopy(createdSecret)}
                      aria-label={copiedValue === createdSecret ? "Copied token" : "Copy token"}
                      title={copiedValue === createdSecret ? "Copied token" : "Copy token"}
                    >
                      {copiedValue === createdSecret ? <Check size={14} /> : <Copy size={14} />}
                    </IconButton>
                  </Flex>
                </Flex>
              </Card>
            )}
          </Flex>
        </Card>

        <Flex direction="column" gap="3" style={{ marginTop: "var(--space-4)" }}>
          <Flex align="center" justify="between">
            <Text size="3" weight="medium">Active tokens</Text>
            <Badge color="gray" variant="soft">
              {tokens.length}
            </Badge>
          </Flex>
          {loading ? (
            <Text size="2" color="gray">Loading MCP tokens...</Text>
          ) : tokens.length === 0 ? (
            <Text size="2" color="gray">No MCP tokens created for this account.</Text>
          ) : (
            tokens.map((token) => (
              <Card key={token.id}>
                <Flex direction="column" gap="2">
                  <Flex align="center" justify="between" gap="3">
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">{token.label}</Text>
                      <Text size="1" color="gray">
                        Token ending in <code>{token.tokenSuffix}</code>
                      </Text>
                    </Flex>
                    <Button
                      size="1"
                      color="red"
                      variant="soft"
                      disabled={deletingId === token.id}
                      onClick={() => void handleDelete(token.id)}
                    >
                      {deletingId === token.id ? "Deleting..." : "Delete"}
                    </Button>
                  </Flex>
                  <Text size="1" color="gray">Created: {formatTimestamp(token.createdAt, accountDateFormat)}</Text>
                  <Text size="1" color="gray">Expires: {formatTimestamp(token.expiresAt, accountDateFormat)}</Text>
                  <Text size="1" color="gray">Last used: {formatTimestamp(token.lastUsedAt, accountDateFormat)}</Text>
                </Flex>
              </Card>
            ))
          )}
        </Flex>

        {error && (
          <Text size="2" color="red" style={{ marginTop: "var(--space-3)", display: "block" }}>
            {error}
          </Text>
        )}
      </div>

      <Flex
        justify="end"
        style={{ paddingTop: "var(--space-3)", borderTop: "1px solid var(--gray-a5)", flexShrink: 0 }}
      >
        <Button size="2" variant="soft" color="gray" onClick={onClose}>
          Close
        </Button>
      </Flex>
    </Flex>
  );
}
