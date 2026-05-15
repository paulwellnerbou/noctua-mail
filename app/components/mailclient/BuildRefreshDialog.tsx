import { AlertDialog, Button, Flex, Text } from "@radix-ui/themes";
import { useState } from "react";
import AlertDialogContent from "./message/AlertDialogContent";

type BuildRefreshDialogProps = {
  buildVersion: string | null;
  onRefresh: () => void;
};

export default function BuildRefreshDialog({
  buildVersion,
  onRefresh
}: BuildRefreshDialogProps) {
  const normalizedVersion = buildVersion?.trim() ?? "";
  const open = normalizedVersion.length > 0;
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleClick = () => {
    setIsRefreshing(true);
    onRefresh();
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={() => undefined}>
      <AlertDialogContent size="2">
        <AlertDialog.Title size="3">Refresh required</AlertDialog.Title>
        <Flex direction="column" gap="3" mt="3">
          <AlertDialog.Description>
            A newer build is available, and this version may be incompatible with your current
            session.
          </AlertDialog.Description>
          <Text size="2" color="gray">
            Refresh is mandatory before continuing.
            {open ? ` New build: ${normalizedVersion}.` : null}
          </Text>
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Button onClick={handleClick} loading={isRefreshing} disabled={isRefreshing}>
            Refresh now
          </Button>
        </Flex>
      </AlertDialogContent>
    </AlertDialog.Root>
  );
}
