import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Flex, Grid, Text } from "@radix-ui/themes";
import type { CategoryLearningDebugSnapshot } from "@/lib/mail/categorization/debugTypes";

type CategoryDebugResponse = {
  ok?: boolean;
  snapshot?: CategoryLearningDebugSnapshot;
  message?: string;
};

type CategoryModelResetResponse = {
  ok?: boolean;
  message?: string;
};

type Props = {
  accountId?: string;
  isActive: boolean;
  isExistingAccount: boolean;
  onClose: () => void;
  onSave: () => void;
  onModelResetSuccess?: () => void;
  apiFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage?: (res: Response) => Promise<string>;
};

export default function CategorizationTabContent({
  accountId,
  isActive,
  isExistingAccount,
  onClose,
  onSave,
  onModelResetSuccess,
  apiFetch,
  readErrorMessage
}: Props) {
  const [snapshot, setSnapshot] = useState<CategoryLearningDebugSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);

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

  const formatTimestamp = (value?: number | null) => {
    if (!value || !Number.isFinite(value)) return "Never";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "Never";
    }
  };

  const formatCategory = (value: string | null) => {
    if (!value) return "none";
    if (value === "newsletter") return "newsletter";
    if (value === "notification") return "notification";
    if (value === "transactional") return "transactional";
    return value;
  };

  const categoryLabels: Array<"newsletter" | "notification" | "transactional"> = [
    "newsletter",
    "notification",
    "transactional"
  ];

  const loadCategorizationDebug = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError("");
    try {
      const res = await request(`/api/categories/debug?accountId=${encodeURIComponent(accountId)}&limit=20`);
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const data = (await res.json()) as CategoryDebugResponse;
      if (!data?.ok || !data.snapshot) {
        setError(data?.message || "Invalid categorization debug response.");
        return;
      }
      setSnapshot(data.snapshot);
    } catch {
      setError("Failed to load categorization details.");
    } finally {
      setLoading(false);
    }
  }, [accountId, readError, request]);

  const resetCategorizationModel = useCallback(async () => {
    if (!accountId) return;
    const confirmed = window.confirm(
      "Reset the categorization learning model for this account to the default baseline?"
    );
    if (!confirmed) return;
    setResetting(true);
    setError("");
    try {
      const res = await request("/api/categories/model/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId })
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const data = (await res.json()) as CategoryModelResetResponse;
      if (!data?.ok) {
        setError(data?.message || "Failed to reset categorization model.");
        return;
      }
      onModelResetSuccess?.();
      await loadCategorizationDebug();
    } catch {
      setError("Failed to reset categorization model.");
    } finally {
      setResetting(false);
    }
  }, [accountId, loadCategorizationDebug, onModelResetSuccess, readError, request]);

  useEffect(() => {
    if (!isActive || !accountId || !isExistingAccount) return;
    void loadCategorizationDebug();
  }, [accountId, isActive, isExistingAccount, loadCategorizationDebug]);

  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between" gap="3" wrap="wrap">
            <Text size="2" color="gray">
              Inspect learned category calibration and recent feedback events for this account.
            </Text>
            <Flex align="center" gap="2" wrap="wrap">
              <Button
                size="1"
                variant="soft"
                color="red"
                onClick={() => void resetCategorizationModel()}
                disabled={resetting || loading || !accountId}
              >
                {resetting ? "Resetting..." : "Reset learning model"}
              </Button>
              <Button
                size="1"
                variant="soft"
                onClick={() => void loadCategorizationDebug()}
                disabled={loading || resetting || !accountId}
              >
                {loading ? "Refreshing..." : "Refresh"}
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

          <Card size="2">
            <Flex direction="column" gap="2">
              <Text size="3" weight="medium">
                Model
              </Text>
              {snapshot?.model ? (
                <Grid columns={{ initial: "1", sm: "2" }} gap="2">
                  <Text size="2">Version: {snapshot.model.version}</Text>
                  <Text size="2">Examples: {snapshot.model.examples}</Text>
                  <Text size="2">Updated: {formatTimestamp(snapshot.model.updatedAt)}</Text>
                  <Text size="2">Learning rate: {snapshot.model.learningRate}</Text>
                  <Text size="2">L2: {snapshot.model.l2}</Text>
                  <Text size="2">
                    Features:{" "}
                    {categoryLabels
                      .map((category) => `${category}=${snapshot.model?.featureCounts[category] ?? 0}`)
                      .join(" · ")}
                  </Text>
                </Grid>
              ) : (
                <Text size="2" color="gray">
                  No learned model yet. Use message menu category actions to create feedback events.
                </Text>
              )}
            </Flex>
          </Card>

          <Card size="2">
            <Flex direction="column" gap="2">
              <Text size="3" weight="medium">
                Category Distribution
              </Text>
              <Flex direction="column" gap="1">
                {(snapshot?.categoryCounts ?? []).map((entry) => (
                  <Text key={entry.category} size="2">
                    {entry.category}: {entry.count}
                  </Text>
                ))}
              </Flex>
              <Text size="2">Manual category overrides: {snapshot?.manualCategorizedCount ?? 0}</Text>
            </Flex>
          </Card>

          <Card size="2">
            <Flex direction="column" gap="2">
              <Text size="3" weight="medium">
                Feedback Events
              </Text>
              <Text size="2">
                Total: {snapshot?.feedback.totalEvents ?? 0} · Last: {formatTimestamp(snapshot?.feedback.lastEventAt)}
              </Text>
              <Text size="2" weight="medium">
                Top transitions
              </Text>
              <Flex direction="column" gap="1">
                {(snapshot?.feedback.transitions ?? []).slice(0, 8).map((entry) => (
                  <Text
                    key={`${entry.previousCategory ?? "none"}-${entry.nextCategory ?? "none"}-${entry.count}`}
                    size="2"
                  >
                    {formatCategory(entry.previousCategory)} → {formatCategory(entry.nextCategory)}: {entry.count}
                  </Text>
                ))}
              </Flex>
              <Text size="2" weight="medium">
                Recent events
              </Text>
              <Flex direction="column" gap="1">
                {(snapshot?.feedback.recent ?? []).map((entry) => (
                  <Text
                    key={`${entry.createdAt}-${entry.messageId}-${entry.previousCategory ?? "none"}-${entry.nextCategory ?? "none"}`}
                    size="2"
                  >
                    {formatTimestamp(entry.createdAt)} · {formatCategory(entry.previousCategory)} →{" "}
                    {formatCategory(entry.nextCategory)} · features: {entry.featureCount}
                  </Text>
                ))}
                {(snapshot?.feedback.recent ?? []).length === 0 && (
                  <Text size="2" color="gray">
                    No feedback events yet.
                  </Text>
                )}
              </Flex>
            </Flex>
          </Card>

          <Card size="2">
            <Flex direction="column" gap="2">
              <Text size="3" weight="medium">
                Top Learned Features
              </Text>
              {!snapshot?.model ? (
                <Text size="2" color="gray">
                  No model weights available.
                </Text>
              ) : (
                <Grid columns={{ initial: "1", sm: "3" }} gap="3">
                  {categoryLabels.map((category) => (
                    <Flex key={category} direction="column" gap="1">
                      <Text size="2" weight="medium">
                        {category}
                      </Text>
                      {snapshot.model?.topWeights[category].length ? (
                        snapshot.model.topWeights[category].map((entry) => (
                          <Text
                            key={`${category}-${entry.feature}`}
                            size="1"
                            color="gray"
                            style={{ overflowWrap: "anywhere" }}
                          >
                            {entry.feature}: {entry.weight >= 0 ? "+" : ""}
                            {entry.weight}
                          </Text>
                        ))
                      ) : (
                        <Text size="1" color="gray">
                          No features
                        </Text>
                      )}
                    </Flex>
                  ))}
                </Grid>
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
          Cancel
        </Button>
        <Button size="2" onClick={onSave} disabled={!isExistingAccount}>
          Save
        </Button>
      </Flex>
    </Flex>
  );
}
