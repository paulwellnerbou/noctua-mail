import { AlertDialog, Box, Button, Flex, Text } from "@radix-ui/themes";
import type { FullSyncConfirmState } from "../types";
import AlertDialogContent from "./AlertDialogContent";

type FullSyncConfirmDialogProps = {
  confirmState: FullSyncConfirmState | null;
  onOpenChange: (open: boolean) => void;
  resolveConfirm: (confirmed: boolean) => void;
};

export default function FullSyncConfirmDialog({
  confirmState,
  onOpenChange,
  resolveConfirm
}: FullSyncConfirmDialogProps) {
  return (
    <AlertDialog.Root open={Boolean(confirmState)} onOpenChange={onOpenChange}>
      <AlertDialogContent size="2">
        <AlertDialog.Title size="3">Full sync required confirmation</AlertDialog.Title>
        <AlertDialog.Description>
          A full sync is about to start. Review the details below before continuing.
        </AlertDialog.Description>
        <Box
          mt="4"
          p="3"
          style={{
            borderRadius: "12px",
            background: "var(--gray-3)",
            border: "1px solid var(--gray-6)",
            userSelect: "text"
          }}
        >
          <Flex direction="column" gap="2">
            <Text size="2" style={{ whiteSpace: "pre-wrap" }}>
              <strong>Account:</strong> {confirmState?.accountId ?? ""}
            </Text>
            <Text size="2" style={{ whiteSpace: "pre-wrap" }}>
              <strong>Scope:</strong> {confirmState?.scopeLabel ?? ""}
            </Text>
            <Text size="2" style={{ whiteSpace: "pre-wrap" }}>
              <strong>Mode:</strong> {confirmState?.mode ?? "full"}
            </Text>
            <Text size="2" style={{ whiteSpace: "pre-wrap" }}>
              <strong>Reason:</strong> {confirmState?.reason ?? ""}
            </Text>
          </Flex>
        </Box>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" onClick={() => resolveConfirm(false)}>
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="orange" onClick={() => resolveConfirm(true)}>
              Start full sync
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialogContent>
    </AlertDialog.Root>
  );
}
