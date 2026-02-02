import type React from "react";
import { Check, Copy, X } from "lucide-react";
import { Dialog, Flex, IconButton, Switch, Text } from "@radix-ui/themes";
import styles from "./ThreadJsonModal.module.css";

type ThreadJsonModalProps = {
  open: boolean;
  omitBody: boolean;
  jsonPayload: unknown;
  copyOk: boolean;
  onClose: () => void;
  onToggleOmitBody: () => void;
  onCopyOk: (value: boolean) => void;
};

export default function ThreadJsonModal({
  open,
  omitBody,
  jsonPayload,
  copyOk,
  onClose,
  onToggleOmitBody,
  onCopyOk
}: ThreadJsonModalProps) {
  if (!open) return null;

  const payload = JSON.stringify(jsonPayload, null, 2);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <Dialog.Content size="4" className={styles.content}>
        <Flex direction="column" gap="3" className={styles.body}>
          <Flex align="center" justify="between" className={styles.header}>
            <Dialog.Title size="4">Thread JSON</Dialog.Title>
            <IconButton variant="ghost" aria-label="Close" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </Flex>
          <Text size="2" color="gray">
            Messages currently visible in the message view pane (thread).
          </Text>
          <Flex align="center" gap="2" className={styles.toolbar}>
            <Switch
              checked={!omitBody}
              onCheckedChange={() => onToggleOmitBody()}
              aria-label="Include body"
            />
            <Text size="2">Include body</Text>
          </Flex>
          <div className={styles.jsonBlock}>
            <pre className={styles.jsonView}>{payload}</pre>
            <IconButton
              size="1"
              variant="surface"
              className={`${styles.copyButton} ${copyOk ? styles.copyOk : ""}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(payload);
                  onCopyOk(true);
                  setTimeout(() => onCopyOk(false), 1200);
                } catch {
                  // ignore
                }
              }}
              aria-label="Copy JSON"
              title="Copy JSON"
            >
              {copyOk ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </div>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
