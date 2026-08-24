import { AlertDialog, Button, Flex, IconButton, Text } from "@radix-ui/themes";
import { X } from "lucide-react";
import type { Attachment } from "@/lib/data";
import AlertDialogContent from "./AlertDialogContent";
import styles from "./AttachmentRemoval.module.css";

const isImageAttachment = (attachment: Attachment) =>
  (attachment.contentType ?? "").toLowerCase().startsWith("image/");

// The inline footer/signature images are hidden from the normal attachment list
// (they render inside the HTML body), so removing them needs its own surface.
export function InlineImageRemovalList({
  images,
  onRequestRemove
}: {
  images: Attachment[];
  onRequestRemove: (attachment: Attachment) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="attachments">
      <div className="attachments-header">
        <h4>Images in message</h4>
      </div>
      <div className={styles.inlineImageList}>
        {images.map((image) => (
          <div key={image.id} className={styles.inlineImageItem}>
            {image.url ? (
              <img
                className={styles.inlineImageThumb}
                src={image.url}
                alt={image.filename || "inline image"}
                loading="lazy"
                decoding="async"
              />
            ) : null}
            <span className={styles.inlineImageName} title={image.filename || undefined}>
              {image.filename || "inline image"}
            </span>
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              title="Remove image"
              aria-label={`Remove ${image.filename || "inline image"}`}
              onClick={() => onRequestRemove(image)}
            >
              <X size={12} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

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
