import { Button, Card, Flex, Grid, Select, Text, TextArea, TextField } from "@radix-ui/themes";
import Field from "@/app/components/account-settings/Field";
import type { Account, AccountSettings } from "@/lib/data";

type Props = {
  editingAccount: Account;
  isExistingAccount: boolean;
  canSave: boolean;
  onUpdateSettings: (next: AccountSettings) => void;
  onClose: () => void;
  onSave: () => void;
};

export default function SignaturesTabContent({
  editingAccount,
  isExistingAccount,
  canSave,
  onUpdateSettings,
  onClose,
  onSave
}: Props) {
  const signatures = editingAccount.settings?.signatures ?? [];

  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <Flex direction="column" gap="4" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <Text size="2" color="gray">
          Manage signatures for this account.
        </Text>
        <Flex align="center" justify="between">
          <Text size="3" weight="medium">
            Signature list
          </Text>
          <Button
            size="1"
            variant="soft"
            onClick={() => {
              const next = {
                id: crypto.randomUUID(),
                name: "New signature",
                body: ""
              };
              onUpdateSettings({ signatures: [...signatures, next] });
            }}
          >
            Add signature
          </Button>
        </Flex>
        <Grid columns="2" gap="3">
          <Field label="Default signature">
            <Select.Root
              value={editingAccount.settings?.defaultSignatureId ?? "none"}
              onValueChange={(value) =>
                onUpdateSettings({
                  defaultSignatureId: value === "none" ? "" : value
                })
              }
            >
              <Select.Trigger style={{ width: "100%" }} placeholder="None" />
              <Select.Content position="popper">
                <Select.Item value="none">None</Select.Item>
                {signatures.map((signature) => (
                  <Select.Item key={signature.id} value={signature.id}>
                    {signature.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field>
        </Grid>
        {signatures.length === 0 ? (
          <Text size="2" color="gray">
            No signatures yet.
          </Text>
        ) : (
          <Flex direction="column" gap="3">
            {signatures.map((signature) => (
              <Card key={signature.id} size="2">
                <Flex direction="column" gap="3">
                  <Field label="Name">
                    <TextField.Root
                      value={signature.name}
                      onChange={(event) => {
                        const nextSignatures = signatures.map((entry) =>
                          entry.id === signature.id ? { ...entry, name: event.target.value } : entry
                        );
                        onUpdateSettings({ signatures: nextSignatures });
                      }}
                    />
                  </Field>
                  <Field label="Signature text">
                    <TextArea
                      rows={8}
                      style={{ resize: "vertical" }}
                      value={signature.body}
                      onChange={(event) => {
                        const nextSignatures = signatures.map((entry) =>
                          entry.id === signature.id ? { ...entry, body: event.target.value } : entry
                        );
                        onUpdateSettings({ signatures: nextSignatures });
                      }}
                    />
                  </Field>
                  <Flex justify="end">
                    <Button
                      size="1"
                      variant="ghost"
                      color="red"
                      onClick={() => {
                        const nextSignatures = signatures.filter((entry) => entry.id !== signature.id);
                        const nextDefault =
                          editingAccount.settings?.defaultSignatureId === signature.id
                            ? ""
                            : editingAccount.settings?.defaultSignatureId ?? "";
                        onUpdateSettings({
                          signatures: nextSignatures,
                          defaultSignatureId: nextDefault
                        });
                      }}
                    >
                      Delete
                    </Button>
                  </Flex>
                </Flex>
              </Card>
            ))}
          </Flex>
        )}
      </Flex>

      <Flex
        justify="end"
        align="center"
        gap="3"
        wrap="wrap"
        style={{ paddingTop: "var(--space-3)", borderTop: "1px solid var(--gray-a5)" }}
      >
        <Button size="2" variant="soft" color="gray" onClick={onClose}>
          Cancel
        </Button>
        <Button size="2" onClick={onSave} disabled={!isExistingAccount || !canSave}>
          Save
        </Button>
      </Flex>
    </Flex>
  );
}
