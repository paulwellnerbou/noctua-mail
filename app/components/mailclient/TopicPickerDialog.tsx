"use client";

import { useState, useEffect } from "react";
import { Check, Plus } from "lucide-react";
import { Badge, Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import type { Topic, TopicColor } from "@/lib/data";
import { topicColorToScale } from "@/lib/data";
import TopicBadge from "./TopicBadge";
import TopicColorPicker from "./TopicColorPicker";
import DialogTitleBar from "./message/DialogTitleBar";
import styles from "./TopicPickerDialog.module.css";

type TopicPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTopics: Topic[];
  messageTopics: Topic[];
  suggestions?: Topic[];
  onSave: (topicIds: string[]) => Promise<void>;
  onCreateTopic: (name: string, color: TopicColor | null, shortName?: string | null) => Promise<Topic>;
};

function TopicRow({
  topic,
  checked,
  onToggle
}: {
  topic: Topic;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Flex align="center" gap="2" className={styles.topicRow} onClick={onToggle}>
      <span className={styles.checkBox}>
        {checked && <Check size={12} />}
      </span>
      <TopicBadge topic={topic} showText size="1" />
    </Flex>
  );
}

export default function TopicPickerDialog({
  open,
  onOpenChange,
  allTopics,
  messageTopics,
  suggestions = [],
  onSave,
  onCreateTopic
}: TopicPickerDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [newColor, setNewColor] = useState<TopicColor | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(new Set(messageTopics.map((t) => t.id)));
      setNewName("");
      setNewShortName("");
      setShowCreate(false);
    }
    // messageTopics intentionally excluded: only reset when dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleTopic(topicId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }

  async function handleCreateAndAdd() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const topic = await onCreateTopic(newName.trim(), newColor, newShortName.trim() || null);
      setSelected((prev) => new Set(prev).add(topic.id));
      setNewName("");
      setNewShortName("");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(Array.from(selected));
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  // Suggestions are topics not already shown in the full list that are suggested.
  // (allTopics always includes everything; suggestions may overlap — we just mark them.)
  const suggestedIds = new Set(suggestions.map((t) => t.id));
  const visibleSuggestions = suggestions.filter((t) =>
    allTopics.some((a) => a.id === t.id)
  );
  // Non-suggested topics shown in the main list
  const remainingTopics = allTopics.filter((t) => !suggestedIds.has(t.id));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="360px" aria-describedby={undefined}>
        <DialogTitleBar title="Topics" onClose={() => onOpenChange(false)} />
        <Flex direction="column" gap="2" mt="3">
          {allTopics.length === 0 && !showCreate && (
            <Text size="2" color="gray">No topics yet. Create one below.</Text>
          )}

          {visibleSuggestions.length > 0 && (
            <>
              <Text size="1" color="gray" className={styles.sectionLabel}>Suggested</Text>
              {visibleSuggestions.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  checked={selected.has(topic.id)}
                  onToggle={() => toggleTopic(topic.id)}
                />
              ))}
              {remainingTopics.length > 0 && (
                <Text size="1" color="gray" className={styles.sectionLabel}>All topics</Text>
              )}
            </>
          )}

          {remainingTopics.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              checked={selected.has(topic.id)}
              onToggle={() => toggleTopic(topic.id)}
            />
          ))}

          {showCreate ? (
            <Flex direction="column" gap="2" align="center" className={styles.createSection}>
              <TextField.Root
                placeholder="Topic name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateAndAdd();
                  if (e.key === "Escape") setShowCreate(false);
                }}
                autoFocus
                style={{ width: "100%" }}
              />
              <TextField.Root
                placeholder="Short name for message list (optional)"
                value={newShortName}
                onChange={(e) => setNewShortName(e.target.value)}
                style={{ width: "100%" }}
              />
              <Badge size="1" variant="soft" color={topicColorToScale(newColor) as any}>
                {newShortName.trim() || newName.trim() || (newColor ?? "No color")}
              </Badge>
              <TopicColorPicker value={newColor} onChange={setNewColor} swatchSize="sm" />
              <Flex gap="2" justify="end" style={{ width: "100%" }}>
                <Button size="1" onClick={handleCreateAndAdd} disabled={!newName.trim() || creating} loading={creating}>
                  Create &amp; add
                </Button>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => {
                    setShowCreate(false);
                    setNewShortName("");
                  }}
                >
                  Cancel
                </Button>
              </Flex>
            </Flex>
          ) : (
            <Button size="1" variant="ghost" onClick={() => setShowCreate(true)} className={styles.newTopicBtn}>
              <Plus size={12} /> New topic
            </Button>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || selected.size === 0} loading={saving}>
            Apply
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
