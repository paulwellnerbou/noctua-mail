import React from "react";
import { AlertDialog, Button, Flex } from "@radix-ui/themes";
import type { ThreadDeleteConfirmState } from "../types";

interface ThreadDeleteConfirmDialogProps {
  threadDeleteConfirm: ThreadDeleteConfirmState | null;
  onOpenChange: (open: boolean) => void;
  resolveThreadDeleteConfirm: (confirmed: boolean) => void;
}

export default function ThreadDeleteConfirmDialog({
  threadDeleteConfirm,
  onOpenChange,
  resolveThreadDeleteConfirm
}: ThreadDeleteConfirmDialogProps) {
  return (
    <AlertDialog.Root open={Boolean(threadDeleteConfirm)} onOpenChange={onOpenChange}>
      <AlertDialog.Content size="2" style={{ width: "min(460px, 92vw)" }}>
        <AlertDialog.Title size="3">
          {threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0
            ? "Delete thread?"
            : "Move thread to Trash?"}
        </AlertDialog.Title>
        <AlertDialog.Description>
          {threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0
            ? threadDeleteConfirm.moveToTrashCount > 0
              ? `${threadDeleteConfirm.permanentDeleteCount} messages will be deleted permanently, and ${threadDeleteConfirm.moveToTrashCount} will be moved to Trash.`
              : threadDeleteConfirm.permanentDeleteCount > 1
                ? `All ${threadDeleteConfirm.permanentDeleteCount} messages in this thread will be deleted permanently.`
                : "This message will be deleted permanently."
            : threadDeleteConfirm?.messageCount && threadDeleteConfirm.messageCount > 1
              ? `All ${threadDeleteConfirm.messageCount} messages in this thread will be moved to Trash.`
              : "This message will be moved to Trash."}
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" onClick={() => resolveThreadDeleteConfirm(false)}>
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button
              color={
                threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0 ? "red" : "gray"
              }
              variant={
                threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0
                  ? "solid"
                  : "soft"
              }
              onClick={() => resolveThreadDeleteConfirm(true)}
            >
              {threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0
                ? "Delete permanently"
                : "Move to Trash"}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
