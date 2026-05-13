"use client";

import { Dialog } from "@radix-ui/themes";
import type { RecipientAlias } from "@/lib/data";
import RecipientAliasManager from "./RecipientAliasManager";
import DialogTitleBar from "./message/DialogTitleBar";

type RecipientAliasDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aliases: RecipientAlias[];
  resetKey: string;
  initialAliasId?: string | null;
  initialRecipients?: string;
  onCreateAlias: (name: string, recipients: string) => Promise<RecipientAlias>;
  onUpdateAlias: (aliasId: string, name: string, recipients: string) => Promise<RecipientAlias>;
  onDeleteAlias: (aliasId: string) => Promise<void>;
};

export default function RecipientAliasDialog({
  open,
  onOpenChange,
  aliases,
  resetKey,
  initialAliasId,
  initialRecipients,
  onCreateAlias,
  onUpdateAlias,
  onDeleteAlias
}: RecipientAliasDialogProps) {
  const title = initialAliasId ? "Manage Recipient Aliases" : "Create Mailing List Alias";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="620px" aria-describedby={undefined}>
        <DialogTitleBar title={title} onClose={() => onOpenChange(false)} />
        <div style={{ marginTop: "var(--space-3)" }}>
          <RecipientAliasManager
            aliases={aliases}
            resetKey={resetKey}
            initialAliasId={initialAliasId}
            initialRecipients={initialRecipients}
            onCreateAlias={onCreateAlias}
            onUpdateAlias={onUpdateAlias}
            onDeleteAlias={onDeleteAlias}
            onCreateSuccess={() => onOpenChange(false)}
          />
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
