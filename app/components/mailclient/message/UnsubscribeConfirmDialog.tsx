import React from "react";
import { AlertDialog, Button, Flex, Text } from "@radix-ui/themes";
import AlertDialogContent from "./AlertDialogContent";

interface UnsubscribeConfirmDialogProps {
  unsubscribeConfirm: { sender: string; listId?: string } | null;
  onOpenChange: (open: boolean) => void;
  resolveUnsubscribeConfirm: (confirmed: boolean) => void;
}

export default function UnsubscribeConfirmDialog({
  unsubscribeConfirm,
  onOpenChange,
  resolveUnsubscribeConfirm
}: UnsubscribeConfirmDialogProps) {
  return (
    <AlertDialog.Root open={Boolean(unsubscribeConfirm)} onOpenChange={onOpenChange}>
      <AlertDialogContent size="2">
        <AlertDialog.Title size="3">Unsubscribe from mailing list?</AlertDialog.Title>
        <AlertDialog.Description>
          {unsubscribeConfirm?.sender && (
            <>
              <Text weight="medium" style={{ display: "block", marginBottom: "8px" }}>
                {unsubscribeConfirm.sender}
              </Text>
            </>
          )}
          {unsubscribeConfirm?.listId && (
            <>
              <Text size="2" color="gray" style={{ display: "block", marginBottom: "8px" }}>
                {unsubscribeConfirm.listId}
              </Text>
            </>
          )}
          This will send a one-click unsubscribe request to the sender.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" onClick={() => resolveUnsubscribeConfirm(false)}>
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" color="blue" onClick={() => resolveUnsubscribeConfirm(true)}>
              Unsubscribe
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialogContent>
    </AlertDialog.Root>
  );
}
