"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { Badge, Box, Card, Flex, Heading, IconButton, Popover, Text } from "@radix-ui/themes";
import type { Folder } from "@/lib/data";
import type { SyncJobProgress } from "../types";
import {
  BottomStatusTriggerButton,
  type BottomStatusTone
} from "./BottomStatusSection";

type ProcessStatusPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSyncing: boolean;
  isRecomputingThreads: boolean;
  isRecomputingCategories: boolean;
  syncingFolders: Set<string>;
  syncProgressItems: SyncJobProgress[];
  accountFolders: Folder[];
};

const SYNC_PHASE_LABELS: Record<SyncJobProgress["phase"], string> = {
  starting: "Preparing",
  fetching: "Fetching",
  finalizing: "Finalizing",
  done: "Done",
  failed: "Failed"
};

function formatSyncPercent(percent?: number) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "";
  const normalized = Math.max(0, Math.min(100, percent));
  return normalized % 1 === 0 ? `${normalized.toFixed(0)}%` : `${normalized.toFixed(1)}%`;
}

function formatSyncCount(progress: SyncJobProgress) {
  const processed =
    typeof progress.processed === "number" && Number.isFinite(progress.processed)
      ? Math.max(0, Math.round(progress.processed))
      : 0;
  if (
    typeof progress.estimatedTotal === "number" &&
    Number.isFinite(progress.estimatedTotal) &&
    progress.estimatedTotal > 0
  ) {
    return `${processed}/${Math.max(0, Math.round(progress.estimatedTotal))}`;
  }
  if (processed <= 0) return "";
  return `${processed}`;
}

function formatSyncProgressSummary(progress: SyncJobProgress) {
  const countLabel = formatSyncCount(progress);
  const percentLabel = formatSyncPercent(progress.percent);
  const metrics = [percentLabel, countLabel].filter(Boolean).join(" · ");
  const explicitMessage = progress.message?.trim();
  if (explicitMessage) {
    return metrics ? `${explicitMessage} · ${metrics}` : explicitMessage;
  }
  const phaseLabel = SYNC_PHASE_LABELS[progress.phase] ?? "Running";
  return metrics ? `${phaseLabel} · ${metrics}` : phaseLabel;
}

function resolveSyncScopeLabel(progress: SyncJobProgress, folderById: Map<string, Folder>) {
  const folderName = progress.folderId ? folderById.get(progress.folderId)?.name : undefined;
  return folderName || progress.mailboxPath || "Mailbox";
}

export default function ProcessStatusPopover({
  open,
  onOpenChange,
  isSyncing,
  isRecomputingThreads,
  isRecomputingCategories,
  syncingFolders,
  syncProgressItems,
  accountFolders
}: ProcessStatusPopoverProps) {
  const folderById = useMemo(
    () => new Map(accountFolders.map((folder) => [folder.id, folder])),
    [accountFolders]
  );
  const syncingFolderItems = Array.from(syncingFolders)
    .map((folderId) => folderById.get(folderId))
    .filter((folder): folder is Folder => Boolean(folder));
  const sortedSyncProgressItems = useMemo(
    () => [...syncProgressItems].sort((left, right) => right.updatedAt - left.updatedAt),
    [syncProgressItems]
  );
  const syncProgressFolderIds = useMemo(
    () =>
      new Set(
        sortedSyncProgressItems
          .map((progress) => progress.folderId)
          .filter((folderId): folderId is string => Boolean(folderId))
      ),
    [sortedSyncProgressItems]
  );
  const fallbackSyncingFolderItems = syncingFolderItems.filter(
    (folder) => !syncProgressFolderIds.has(folder.id)
  );
  const syncRows = [
    ...sortedSyncProgressItems.map((progress) => ({
      key: progress.jobId,
      title: resolveSyncScopeLabel(progress, folderById),
      detail: formatSyncProgressSummary(progress)
    })),
    ...fallbackSyncingFolderItems.map((folder) => ({
      key: `fallback-${folder.id}`,
      title: folder.name,
      detail: "Preparing sync…"
    }))
  ];
  const additionalProcessRows = [
    isRecomputingThreads ? "Recomputing threads…" : "",
    isRecomputingCategories ? "Recomputing categories…" : ""
  ].filter(Boolean);
  const activeProcessCount = syncRows.length + additionalProcessRows.length;
  const latestSyncProgress = sortedSyncProgressItems[0] ?? null;
  const latestSyncStatusValue = (() => {
    if (latestSyncProgress) {
      const scopeLabel = resolveSyncScopeLabel(latestSyncProgress, folderById);
      const percentLabel = formatSyncPercent(latestSyncProgress.percent);
      return percentLabel ? `Syncing ${scopeLabel} (${percentLabel})` : `Syncing ${scopeLabel}...`;
    }
    if (syncingFolderItems.length > 0) {
      const firstFolderName = syncingFolderItems[0]?.name;
      if (!firstFolderName) return "Syncing folder...";
      if (syncingFolderItems.length === 1) return `Syncing ${firstFolderName}...`;
      return `Syncing ${firstFolderName} +${syncingFolderItems.length - 1} more...`;
    }
    return isSyncing ? "Syncing mailbox..." : "";
  })();
  const processStatusItems = [
    latestSyncStatusValue,
    ...additionalProcessRows
  ].filter(Boolean);
  const processStatusValue = processStatusItems.length > 0 ? processStatusItems.join(" · ") : "Idle";
  const processStatusTone: BottomStatusTone = processStatusItems.length > 0 ? "normal" : "muted";

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger>
        <BottomStatusTriggerButton
          label="Processes"
          value={processStatusValue}
          tone={processStatusTone}
        />
      </Popover.Trigger>
      <Popover.Content
        className="bottom-popover bottom-popover-process"
        side="top"
        align="start"
        sideOffset={8}
      >
        <Flex align="center" justify="between" className="popover-title-row">
          <Flex align="baseline" gap="3">
            <Heading size="3" weight="medium" className="reminder-main-title">
              Processes
            </Heading>
            <Badge color="gray" variant="soft" radius="full">
              {activeProcessCount}
            </Badge>
          </Flex>
          <IconButton
            variant="ghost"
            color="gray"
            size="2"
            title="Close processes"
            aria-label="Close processes"
            onClick={() => onOpenChange(false)}
          >
            <X size={16} />
          </IconButton>
        </Flex>
        <Box className="popover-body">
          {activeProcessCount > 0 ? (
            <Card size="1" className="process-item-card">
              <div className="process-list">
                {syncRows.map((row) => (
                  <div key={row.key} className="process-row">
                    <Text size="2" weight="medium" className="process-row-title">
                      {row.title}
                    </Text>
                    <Text size="1" color="gray" className="process-row-detail">
                      {row.detail}
                    </Text>
                  </div>
                ))}
                {additionalProcessRows.map((row) => (
                  <div key={row} className="process-row">
                    <Text size="2" weight="medium" className="process-row-title">
                      {row}
                    </Text>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Flex align="center" justify="center" p="4" className="empty-state">
              <Text size="2" color="gray">No active processes.</Text>
            </Flex>
          )}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
}
