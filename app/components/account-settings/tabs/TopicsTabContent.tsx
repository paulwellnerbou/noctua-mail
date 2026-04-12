"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Card, Flex, IconButton, Switch, Text, TextField } from "@radix-ui/themes";
import {
  buildAccountTopicPath,
  buildAccountTopicSignalsPath,
  buildAccountTopicStatsPath,
  buildAccountTopicsPath,
  buildAccountTopicTransferPath
} from "@/lib/accountApiPaths";
import type { AccountSettings, Topic, TopicColor, TopicSuggestionSignal } from "@/lib/data";
import { topicColorToScale } from "@/lib/data";
import type { TopicStat, TopicTransferImportSummary } from "@/lib/topics";
import TopicColorPicker from "@/app/components/mailclient/TopicColorPicker";
import ImportReplaceConfirmDialog from "./ImportReplaceConfirmDialog";
import styles from "./TopicsTabContent.module.css";

type Props = {
  accountId?: string;
  isActive: boolean;
  isExistingAccount: boolean;
  apiFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onTopicsChanged?: (topics: Topic[]) => void;
  topicColorRows?: boolean;
  onUpdateSettings?: (next: AccountSettings) => void;
  currentAppearance?: AccountSettings["appearance"];
  onClose?: () => void;
  onSave?: () => void;
  canSave?: boolean;
};

type TopicTransferExportResponse = {
  ok?: boolean;
  data?: unknown;
  message?: string;
};

type TopicTransferImportResponse = {
  ok?: boolean;
  summary?: TopicTransferImportSummary;
  message?: string;
};

const TOPIC_SIGNAL_LABELS: Record<TopicSuggestionSignal, string> = {
  senderEmail: "sender",
  senderDomain: "sender domain",
  recipient: "recipient",
  listId: "listId",
  jiraProjectKey: "JIRA project"
};

export default function TopicsTabContent({
  accountId,
  isActive,
  isExistingAccount,
  apiFetch,
  onTopicsChanged,
  topicColorRows,
  onUpdateSettings,
  currentAppearance,
  onClose,
  onSave,
  canSave
}: Props) {
  const request = apiFetch ?? fetch;
  const saveDisabled = !isExistingAccount || !canSave;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [statsById, setStatsById] = useState<Map<string, TopicStat>>(new Map());
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editShortName, setEditShortName] = useState("");
  const [editColor, setEditColor] = useState<TopicColor | null>(null);
  const [newName, setNewName] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [newColor, setNewColor] = useState<TopicColor | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [removingSignalKey, setRemovingSignalKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const readError = useCallback(async (res: Response) => {
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      return data?.message || data?.error || `Request failed (${res.status})`;
    } catch {
      return `Request failed (${res.status})`;
    }
  }, []);

  const loadTopics = useCallback(async () => {
    if (!accountId) return [];
    setLoading(true);
    try {
      const [topicsRes, statsRes] = await Promise.all([
        request(buildAccountTopicsPath(accountId)),
        request(buildAccountTopicStatsPath(accountId))
      ]);
      const topicsData = await topicsRes.json();
      const statsData = await statsRes.json();
      const nextTopics = topicsData.ok && Array.isArray(topicsData.topics) ? topicsData.topics : [];
      setTopics(nextTopics);
      if (statsData.ok && Array.isArray(statsData.stats)) {
        setStatsById(new Map((statsData.stats as TopicStat[]).map((s) => [s.topicId, s])));
      } else {
        setStatsById(new Map());
      }
      return nextTopics as Topic[];
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  }, [accountId, request]);

  useEffect(() => {
    if (isActive && isExistingAccount) loadTopics();
  }, [isActive, isExistingAccount, loadTopics]);

  const handleCreate = async () => {
    if (!newName.trim() || !accountId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await request(buildAccountTopicsPath(accountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), shortName: newShortName.trim(), color: newColor })
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message ?? "Failed to create topic");
        return;
      }
      const next = [...topics, data.topic].sort((a, b) => a.name.localeCompare(b.name));
      setTopics(next);
      onTopicsChanged?.(next);
      setNewName("");
      setNewShortName("");
      setShowCreate(false);
    } catch {
      setError("Failed to create topic");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (topic: Topic) => {
    setEditingId(topic.id);
    setEditName(topic.name);
    setEditShortName(topic.shortName ?? "");
    setEditColor(topic.color);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditShortName("");
  };

  const handleSaveEdit = async (topicId: string) => {
    if (!accountId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await request(buildAccountTopicPath(accountId, topicId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), shortName: editShortName.trim(), color: editColor })
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message ?? "Failed to update topic");
        return;
      }
      const next = topics
        .map((t) => (t.id === topicId ? data.topic : t))
        .sort((a, b) => a.name.localeCompare(b.name));
      setTopics(next);
      onTopicsChanged?.(next);
      setEditingId(null);
    } catch {
      setError("Failed to update topic");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (topicId: string) => {
    if (!accountId) return;
    setError("");
    setNotice("");
    try {
      await request(buildAccountTopicPath(accountId, topicId), {
        method: "DELETE"
      });
      const next = topics.filter((t) => t.id !== topicId);
      setTopics(next);
      onTopicsChanged?.(next);
    } catch {
      setError("Failed to delete topic");
    }
  };

  const handleExport = useCallback(async () => {
    if (!accountId) return;
    setExporting(true);
    setError("");
    setNotice("");
    try {
      const res = await request(buildAccountTopicTransferPath(accountId));
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const data = (await res.json()) as TopicTransferExportResponse;
      if (!data?.ok || !data.data) {
        setError(data?.message ?? "Failed to export topics data.");
        return;
      }

      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `noctua-topics-${accountId}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice("Topics data exported.");
    } catch {
      setError("Failed to export topics data.");
    } finally {
      setExporting(false);
    }
  }, [accountId, readError, request]);

  const handleRemoveSignal = useCallback(async (
    topicId: string,
    signalType: TopicSuggestionSignal,
    signalValue: string
  ) => {
    if (!accountId) return;
    const normalizedValue = signalValue.trim();
    if (!normalizedValue) return;

    const signalKey = `${topicId}\u0000${signalType}\u0000${normalizedValue}`;
    setRemovingSignalKey(signalKey);
    setError("");
    setNotice("");
    try {
      const res = await request(buildAccountTopicSignalsPath(accountId, topicId), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signalType,
          signalValue: normalizedValue
        })
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      await loadTopics();
      setNotice("Learning signal removed.");
    } catch {
      setError("Failed to remove learning signal.");
    } finally {
      setRemovingSignalKey("");
    }
  }, [accountId, loadTopics, readError, request]);

  const resetImportInput = useCallback(() => {
    if (importInputRef.current) {
      importInputRef.current.value = "";
    }
  }, []);

  const executeImport = useCallback(async (file: File) => {
    if (!accountId) {
      return;
    }

    setImporting(true);
    setError("");
    setNotice("");
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const res = await request(buildAccountTopicTransferPath(accountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: parsed })
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const data = (await res.json()) as TopicTransferImportResponse;
      if (!data?.ok || !data.summary) {
        setError(data?.message ?? "Failed to import topics data.");
        return;
      }
      const nextTopics = await loadTopics();
      onTopicsChanged?.(nextTopics);
      setNotice(
        `Imported ${data.summary.topicCount} topics and ${data.summary.assignmentCount} assignments.`
      );
    } catch (error) {
      setError(error instanceof SyntaxError ? "Invalid JSON file." : "Failed to import topics data.");
    } finally {
      resetImportInput();
      setImporting(false);
    }
  }, [accountId, loadTopics, onTopicsChanged, readError, request, resetImportInput]);

  const handleImportFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !accountId) {
      resetImportInput();
      return;
    }
    setPendingImportFile(file);
  }, [accountId, resetImportInput]);

  const handleImportDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setPendingImportFile(null);
      resetImportInput();
    }
  }, [resetImportInput]);

  const confirmImport = useCallback(() => {
    const file = pendingImportFile;
    if (!file) {
      return;
    }
    setPendingImportFile(null);
    void executeImport(file);
  }, [executeImport, pendingImportFile]);

  if (!isExistingAccount) return null;

  const topicsWithSignals = topics.filter((t) => (statsById.get(t.id)?.topSignals.length ?? 0) > 0);

  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <Flex direction="column" gap="4">
          <Text size="2" color="gray">
            Topics let you group messages by project, interest, or any category you choose. Assign topics from the message menu.
          </Text>

          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />

          <Flex direction="column" gap="3">
            <Text size="3" weight="medium">Settings</Text>
            <Flex direction="column" gap="2">
              <Flex asChild align="center" gap="2">
                <label style={{ cursor: "not-allowed" }}>
                  <Switch size="1" disabled checked={false} />
                  <Text size="2" color="gray">Write topics to IMAP messages (not supported yet)</Text>
                </label>
              </Flex>
              <Flex asChild align="center" gap="2">
                <label>
                  <Switch
                    size="1"
                    checked={topicColorRows ?? true}
                    onCheckedChange={(checked) =>
                      onUpdateSettings?.({
                        appearance: {
                          ...(currentAppearance ?? {}),
                          topicColorRows: checked
                        }
                      })
                    }
                  />
                  <Text size="2">Apply topic color to message rows</Text>
                </label>
              </Flex>
            </Flex>
          </Flex>

          <Flex direction="column" gap="3">
            <Text size="3" weight="medium">Sync</Text>
            <Text size="2" color="gray">
              Export or import all local topics data for this account, including topic assignments used for learning.
            </Text>
            <Flex align="center" gap="2" wrap="wrap">
              <Button
                size="1"
                variant="soft"
                onClick={() => void handleExport()}
                disabled={!accountId || exporting || importing}
              >
                {exporting ? "Exporting..." : "Export"}
              </Button>
              <Button
                size="1"
                variant="soft"
                onClick={() => importInputRef.current?.click()}
                disabled={!accountId || exporting || importing}
              >
                {importing ? "Importing..." : "Import"}
              </Button>
              <Text size="1" color="gray">
                Import replaces the current local Topics data for this account.
              </Text>
            </Flex>
          </Flex>

          <Flex direction="column" gap="3">
            <Text size="3" weight="medium">Topics</Text>

            {error && <Text size="2" color="red">{error}</Text>}
            {notice && <Text size="2" color="green">{notice}</Text>}
            {loading && <Text size="2" color="gray">Loading…</Text>}

            {topics.length > 0 && (
              <Card size="2" className={styles.topicTable}>
                {topics.map((topic) => {
                  if (editingId === topic.id) {
                    return (
                      <div key={topic.id} className={styles.editRow}>
                        <TextField.Root
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit(editingId);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          autoFocus
                        />
                        <TextField.Root
                          placeholder="Short name for message list (optional)"
                          value={editShortName}
                          onChange={(e) => setEditShortName(e.target.value)}
                        />
                        <Flex align="center" gap="2" wrap="wrap">
                          <TopicColorPicker value={editColor} onChange={setEditColor} swatchSize="sm" />
                          <Flex gap="2" ml="auto">
                            <Button size="1" variant="soft" color="gray" onClick={cancelEdit}>Cancel</Button>
                            <Button size="1" onClick={() => handleSaveEdit(editingId)} disabled={!editName.trim() || saving} loading={saving}>Save</Button>
                          </Flex>
                        </Flex>
                      </div>
                    );
                  }
                  const stat = statsById.get(topic.id);
                  return (
                    <div key={topic.id} className={styles.topicRow}>
                      <div className={styles.topicMeta}>
                        <Badge color={topicColorToScale(topic.color) as any} variant="soft" size="2">
                          {topic.name}
                        </Badge>
                        {topic.shortName ? (
                          <Badge
                            color={topicColorToScale(topic.color) as any}
                            variant="soft"
                            size="1"
                            className={styles.topicShortName}
                          >
                            {topic.shortName}
                          </Badge>
                        ) : null}
                      </div>
                      <span className={styles.topicRowCount}>
                        {stat ? `${stat.threadCount} ${stat.threadCount === 1 ? "thread" : "threads"}` : ""}
                      </span>
                      <Flex gap="4">
                        <IconButton size="2" variant="ghost" onClick={() => startEdit(topic)} title="Edit">
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton size="2" variant="ghost" color="red" onClick={() => handleDelete(topic.id)} title="Delete">
                          <Trash2 size={14} />
                        </IconButton>
                      </Flex>
                    </div>
                  );
                })}
              </Card>
            )}

            {topics.length === 0 && !loading && !showCreate && (
              <Text size="2" color="gray">No topics yet.</Text>
            )}

            {showCreate ? (
              <Flex direction="column" gap="2" className={styles.createSection}>
                <TextField.Root
                  placeholder="Topic name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") setShowCreate(false);
                  }}
                  autoFocus
                />
                <TextField.Root
                  placeholder="Short name for message list (optional)"
                  value={newShortName}
                  onChange={(e) => setNewShortName(e.target.value)}
                />
                <Flex align="center" gap="2" wrap="wrap">
                  <TopicColorPicker value={newColor} onChange={setNewColor} swatchSize="sm" />
                  <Flex gap="2" ml="auto">
                    <Button
                      size="1"
                      variant="soft"
                      color="gray"
                      onClick={() => {
                        setShowCreate(false);
                        setNewName("");
                        setNewShortName("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button size="1" onClick={handleCreate} disabled={!newName.trim() || saving} loading={saving}>Create</Button>
                  </Flex>
                </Flex>
              </Flex>
            ) : (
              <Button size="1" variant="soft" onClick={() => setShowCreate(true)} style={{ alignSelf: "flex-start" }}>
                <Plus size={12} /> New topic
              </Button>
            )}
          </Flex>

          <Flex direction="column" gap="3">
            <Text size="3" weight="medium">Learning Data</Text>
            {topicsWithSignals.length === 0 ? (
              <Text size="2" color="gray">No learning data yet. Assign topics to messages to build up signal data.</Text>
            ) : (
              <Card size="2">
                <Flex direction="column" gap="1">
                  {topicsWithSignals.map((topic, topicIdx) => {
                    const signals = statsById.get(topic.id)?.topSignals ?? [];
                    return (
                      <Flex key={topic.id} direction="column" gap="1">
                        {topicIdx > 0 && <div className={styles.signalDivider} />}
                        <Badge color={topicColorToScale(topic.color) as any} variant="soft" size="1" style={{ alignSelf: "flex-start" }}>{topic.name}</Badge>
                        {signals.map((s) => {
                          const signalKey = `${topic.id}\u0000${s.type}\u0000${s.value}`;
                          const removing = removingSignalKey === signalKey;
                          return (
                            <Flex key={`${s.type}:${s.value}`} align="start" gap="2" className={styles.signalRow}>
                              <Text size="1" color="gray" className={styles.signalText}>
                                {TOPIC_SIGNAL_LABELS[s.type]}: {s.value} · {s.count} {s.count === 1 ? "thread" : "threads"}
                              </Text>
                              <IconButton
                                size="1"
                                variant="ghost"
                                color="gray"
                                className={styles.signalRemoveButton}
                                disabled={removing}
                                onClick={() => void handleRemoveSignal(topic.id, s.type, s.value)}
                                title={`Remove ${TOPIC_SIGNAL_LABELS[s.type]} signal`}
                                aria-label={`Remove ${TOPIC_SIGNAL_LABELS[s.type]} signal`}
                              >
                                <X size={10} />
                              </IconButton>
                            </Flex>
                          );
                        })}
                      </Flex>
                    );
                  })}
                </Flex>
              </Card>
            )}
          </Flex>
        </Flex>
      </div>

      <ImportReplaceConfirmDialog
        open={pendingImportFile !== null}
        title="Import topics data?"
        description="Importing topics data replaces all current topics and topic assignments for this account."
        confirmLabel="Import"
        onOpenChange={handleImportDialogOpenChange}
        onConfirm={confirmImport}
      />

      <Flex
        justify="end"
        align="center"
        gap="3"
        wrap="wrap"
        style={{ paddingTop: "var(--space-3)", borderTop: "1px solid var(--gray-a5)", flexShrink: 0 }}
      >
        <Button size="2" variant="soft" color="gray" onClick={onClose}>
          {saveDisabled ? "Close" : "Cancel"}
        </Button>
        <Button size="2" onClick={onSave} disabled={saveDisabled}>
          Save
        </Button>
      </Flex>
    </Flex>
  );
}
