import { AlertDialog, Button, Flex, Text } from "@radix-ui/themes";
import type { Attachment } from "@/lib/data";
import AlertDialogContent from "./AlertDialogContent";

const isImageAttachment = (attachment: Attachment) =>
  (attachment.contentType ?? "").toLowerCase().startsWith("image/");

export function RemoveAttachmentConfirmDialog({
  attachment,
  removing,
  onCancel,
  onConfirm
}: {
  attachment: Attachment | null;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const noun = attachment && isImageAttachment(attachment) ? "image" : "attachment";
  return (
    <AlertDialog.Root
      open={Boolean(attachment)}
      onOpenChange={(open) => {
        if (!open && !removing) onCancel();
      }}
    >
      <AlertDialogContent size="2">
        <AlertDialog.Title size="3">Remove this {noun}?</AlertDialog.Title>
        <AlertDialog.Description>
          <Text as="span">
            {attachment?.filename ? `“${attachment.filename}” ` : `This ${noun} `}
            will be stripped from the message on the mail server and removed from this device. The
            rest of the email is kept. This can’t be undone.
          </Text>
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={onCancel} disabled={removing}>
            Cancel
          </Button>
          {/* Not wrapped in AlertDialog.Action: the removal is async and the
              dialog must stay open, showing progress, until it resolves. */}
          <Button color="red" variant="solid" onClick={onConfirm} loading={removing}>
            Remove {noun}
          </Button>
        </Flex>
      </AlertDialogContent>
    </AlertDialog.Root>
  );
}
