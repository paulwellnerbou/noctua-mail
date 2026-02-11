import { Dialog, Flex, Switch, Text } from "@radix-ui/themes";
import DialogTitleBar from "./DialogTitleBar";
import RawTextPanel from "./RawTextPanel";
import styles from "./ThreadJsonModal.module.css";

type ThreadJsonModalProps = {
  open: boolean;
  omitBody: boolean;
  jsonPayload: unknown;
  onClose: () => void;
  onToggleOmitBody: () => void;
};

export default function ThreadJsonModal({
  open,
  omitBody,
  jsonPayload,
  onClose,
  onToggleOmitBody
}: ThreadJsonModalProps) {
  if (!open) return null;

  const payload = JSON.stringify(jsonPayload, null, 2);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <Dialog.Content size="4" className={styles.content}>
        <Flex direction="column" gap="3" className={styles.body}>
          <DialogTitleBar title="Thread JSON" onClose={onClose} />
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
          <RawTextPanel text={payload} copyText={payload} copyLabel="Copy JSON" />
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
