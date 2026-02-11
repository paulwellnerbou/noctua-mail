"use client";

import { Box, Card, Flex, Popover, Text } from "@radix-ui/themes";
import type { Folder } from "@/lib/data";
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
  accountFolders: Folder[];
};

export default function ProcessStatusPopover({
  open,
  onOpenChange,
  isSyncing,
  isRecomputingThreads,
  isRecomputingCategories,
  syncingFolders,
  accountFolders
}: ProcessStatusPopoverProps) {
  const syncingFolderItems = Array.from(syncingFolders)
    .map((folderId) => accountFolders.find((folder) => folder.id === folderId))
    .filter((folder): folder is Folder => Boolean(folder));
  const processStatusItems = [
    isSyncing ? "Mailbox sync" : "",
    isRecomputingThreads ? "Recomputing threads…" : "",
    isRecomputingCategories ? "Recomputing categories…" : "",
    syncingFolders.size > 0 ? `Folder sync… (${syncingFolders.size})` : ""
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
            !isRecomputingCategories && (
            <Text size="2">No active processes.</Text>
          )}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
}
