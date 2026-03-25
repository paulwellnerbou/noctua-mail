"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, Flex, IconButton, Text, TextArea, TextField } from "@radix-ui/themes";
import type { RecipientAlias } from "@/lib/data";

type RecipientAliasManagerProps = {
  aliases: RecipientAlias[];
  resetKey: string;
  initialAliasId?: string | null;
  initialRecipients?: string;
  onCreateAlias: (name: string, recipients: string) => Promise<RecipientAlias>;
  onUpdateAlias: (aliasId: string, name: string, recipients: string) => Promise<RecipientAlias>;
  onDeleteAlias: (aliasId: string) => Promise<void>;
  onCreateSuccess?: (alias: RecipientAlias) => void;
};

type FormMode = "create" | "edit" | null;

export default function RecipientAliasManager({
  aliases,
  resetKey,
  initialAliasId,
  initialRecipients = "",
  onCreateAlias,
  onUpdateAlias,
  onDeleteAlias,
  onCreateSuccess
}: RecipientAliasManagerProps) {
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [recipients, setRecipients] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingAlias = useMemo(
    () => aliases.find((alias) => alias.id === editingAliasId) ?? null,
    [aliases, editingAliasId]
  );
  const initialAlias = useMemo(
    () => (initialAliasId ? aliases.find((alias) => alias.id === initialAliasId) ?? null : null),
    [aliases, initialAliasId]
  );

  useEffect(() => {
    if (initialAliasId) {
      const alias = initialAlias;
      if (alias) {
        setFormMode("edit");
        setEditingAliasId(alias.id);
        setName(alias.name);
        setRecipients(alias.recipients);
        setError("");
        return;
      }
    }
    if (initialRecipients.trim()) {
      setFormMode("create");
      setEditingAliasId(null);
      setName("");
      setRecipients(initialRecipients.trim());
      setError("");
      return;
    }
    setFormMode(null);
    setEditingAliasId(null);
    setName("");
    setRecipients("");
    setError("");
  }, [initialAlias, initialAliasId, initialRecipients, resetKey]);

  const startCreate = () => {
    setFormMode("create");
    setEditingAliasId(null);
    setName("");
    setRecipients(initialRecipients.trim());
    setError("");
  };

  const startEdit = (alias: RecipientAlias) => {
    setFormMode("edit");
    setEditingAliasId(alias.id);
    setName(alias.name);
    setRecipients(alias.recipients);
    setError("");
  };

  const cancelForm = () => {
    setFormMode(null);
    setEditingAliasId(null);
    setName("");
    setRecipients("");
    setError("");
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedRecipients = recipients.trim();
    if (!trimmedName || !trimmedRecipients) {
      setError("Name and recipients are required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const alias =
        formMode === "edit" && editingAliasId
          ? await onUpdateAlias(editingAliasId, trimmedName, trimmedRecipients)
          : await onCreateAlias(trimmedName, trimmedRecipients);
      if (formMode === "create") {
        onCreateSuccess?.(alias);
      }
      setFormMode("edit");
      setEditingAliasId(alias.id);
      setName(alias.name);
      setRecipients(alias.recipients);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save recipient alias.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (aliasId: string) => {
    setDeletingId(aliasId);
    setError("");
    try {
      await onDeleteAlias(aliasId);
      if (editingAliasId === aliasId) {
        cancelForm();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete recipient alias.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Flex direction="column" gap="4" style={{ minHeight: 0 }}>
      <Text size="2" color="gray">
        Save common recipient combinations under a name and reuse them from compose autocomplete.
      </Text>

      {aliases.length > 0 ? (
        <Card size="2">
          <Flex direction="column" gap="2">
            {aliases.map((alias) => (
              <Flex
                key={alias.id}
                align="start"
                justify="between"
                gap="3"
                style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--gray-a4)" }}
              >
                <Flex direction="column" gap="1" style={{ minWidth: 0, flex: 1 }}>
                  <Text size="2" weight="medium" style={{ overflowWrap: "anywhere" }}>
                    {alias.name}
                  </Text>
                  <Text size="1" color="gray" style={{ overflowWrap: "anywhere" }}>
                    {alias.recipients}
                  </Text>
                </Flex>
                <Flex gap="2" flexShrink="0">
                  <IconButton
                    size="2"
                    variant="ghost"
                    title="Edit alias"
                    onClick={() => startEdit(alias)}
                  >
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton
                    size="2"
                    variant="ghost"
                    color="red"
                    title="Delete alias"
                    disabled={deletingId === alias.id}
                    onClick={() => void handleDelete(alias.id)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </Flex>
              </Flex>
            ))}
          </Flex>
        </Card>
      ) : (
        <Text size="2" color="gray">
          No recipient aliases yet.
        </Text>
      )}

      {formMode ? (
        <Card size="2">
          <Flex direction="column" gap="3">
            <Text size="3" weight="medium">
              {formMode === "edit" && editingAlias ? `Edit ${editingAlias.name}` : "Create mailing list alias"}
            </Text>
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">
                Name
              </Text>
              <TextField.Root
                value={name}
                placeholder="Mailing list alias"
                onChange={(event) => setName(event.target.value)}
              />
            </Flex>
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">
                Recipients
              </Text>
              <TextArea
                value={recipients}
                placeholder={"Name <mail@example.com>, Other Name <other@example.com>"}
                onChange={(event) => setRecipients(event.target.value)}
                rows={5}
              />
            </Flex>
            {error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}
            <Flex gap="2" justify="end">
              <Button variant="soft" color="gray" onClick={cancelForm}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {formMode === "edit" ? "Save alias" : "Create alias"}
              </Button>
            </Flex>
          </Flex>
        </Card>
      ) : (
        <Button
          size="2"
          variant="soft"
          onClick={startCreate}
          style={{ alignSelf: "flex-start" }}
        >
          <Plus size={14} /> New alias
        </Button>
      )}
    </Flex>
  );
}
