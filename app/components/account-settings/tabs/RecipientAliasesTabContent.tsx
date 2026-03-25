"use client";

import { Button, Flex } from "@radix-ui/themes";
import type { RecipientAlias } from "@/lib/data";
import RecipientAliasManager from "@/app/components/mailclient/RecipientAliasManager";

type Props = {
  isExistingAccount: boolean;
  aliases: RecipientAlias[];
  onCreateAlias: (name: string, recipients: string) => Promise<RecipientAlias>;
  onUpdateAlias: (aliasId: string, name: string, recipients: string) => Promise<RecipientAlias>;
  onDeleteAlias: (aliasId: string) => Promise<void>;
  onClose: () => void;
};

export default function RecipientAliasesTabContent({
  isExistingAccount,
  aliases,
  onCreateAlias,
  onUpdateAlias,
  onDeleteAlias,
  onClose
}: Props) {
  if (!isExistingAccount) {
    return null;
  }

  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <RecipientAliasManager
          aliases={aliases}
          resetKey={`settings:${aliases.length}`}
          onCreateAlias={onCreateAlias}
          onUpdateAlias={onUpdateAlias}
          onDeleteAlias={onDeleteAlias}
        />
      </div>
      <Flex
        justify="end"
        style={{ paddingTop: "var(--space-3)", borderTop: "1px solid var(--gray-a5)", flexShrink: 0 }}
      >
        <Button size="2" variant="soft" color="gray" onClick={onClose}>
          Close
        </Button>
      </Flex>
    </Flex>
  );
}
