"use client";

import { useMemo } from "react";
import { Box, Card, Flex, Popover, Text } from "@radix-ui/themes";
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
  starting: "Starting",
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
  const metrics = [countLabel, percentLabel].filter(Boolean).join(" · ");
  const explicitMessage = progress.message?.trim();
  if (explicitMessage) {
    return metrics ? `${explicitMessage} · ${metrics}` : explicitMessage;
  }
  const phaseLabel = SYNC_PHASE_LABELS[progress.phase] ?? "Running";
  return metrics ? `${phaseLabel} · ${metrics}` : phaseLabel;
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
  const latestSyncProgress = sortedSyncProgressItems[0] ?? null;
  const latestSyncProgressSummary = latestSyncProgress ? formatSyncProgressSummary(latestSyncProgress) : "";
  const processStatusItems = [
    isSyncing ? "Mailbox sync" : "",
    isRecomputingThreads ? "Recomputing threads…" : "",
    isRecomputingCategories ? "Recomputing categories…" : "",
    syncingFolders.size > 0 ? `Folder sync… (${syncingFolders.size})` : "",
    latestSyncProgressSummary
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
      <Popover.Content className="bottom-popover" side="top" align="start" sideOffset={8}>
        <Flex align="center" justify="between" className="popover-title">
          <Text size="1" weight="medium" className="bottom-popover-heading">
            Processes
          </Text>
        </Flex>
        <Box className="popover-body">
          {isSyncing && <Text size="2">Mailbox sync running</Text>}
          {isRecomputingThreads && <Text size="2">Recomputing threads…</Text>}
          {isRecomputingCategories && <Text size="2">Recomputing categories…</Text>}
          {sortedSyncProgressItems.length > 0 && (
            <Card size="1">
              <Text size="2">Sync progress</Text>
              <div className="process-list">
                {sortedSyncProgressItems.map((progress) => {
                  const folderName = progress.folderId
                    ? folderById.get(progress.folderId)?.name
                    : undefined;
                  const scopeLabel = folderName || progress.mailboxPath || "Mailbox";
                  return (
                    <Text key={progress.jobId} size="1" color="gray">
                      • {scopeLabel}: {formatSyncProgressSummary(progress)}
                    </Text>
                  );
                })}
              </div>
            </Card>
          )}
          {syncingFolders.size > 0 && (
            <Card size="1">
              <Text size="2">Folder sync running ({syncingFolders.size})</Text>
              <div className="process-list">
                {syncingFolderItems.map((folder) => (
                  <Text key={folder.id} size="1" color="gray">
                    • {folder.name}
                  </Text>
                ))}
              </div>
            </Card>
          )}
          {!isSyncing &&
            syncingFolders.size === 0 &&
            !isRecomputingThreads &&
            !isRecomputingCategories &&
            sortedSyncProgressItems.length === 0 && (
            <Text size="2">No active processes.</Text>
          )}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
}
