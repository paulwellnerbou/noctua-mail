import { Button, Flex, Grid, Select, Switch, Text, TextField } from "@radix-ui/themes";
import Field from "@/app/components/account-settings/Field";
import type { Account, AccountDateFormat, AccountSettings } from "@/lib/data";
import { ACCOUNT_DATE_FORMAT_OPTIONS, normalizeAccountDateFormat } from "@/lib/dateFormatting";

type Props = {
  editingAccount: Account;
  isExistingAccount: boolean;
  isAdminUser: boolean;
  canSave: boolean;
  onUpdateSettings: (next: AccountSettings) => void;
  onClose: () => void;
  onSave: () => void;
};

export default function PreferencesTabContent({
  editingAccount,
  isExistingAccount,
  isAdminUser,
  canSave,
  onUpdateSettings,
  onClose,
  onSave
}: Props) {
  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <Flex direction="column" gap="4" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <Text size="2" color="gray">
          Control behavior, layout, and sync performance.
        </Text>
        <Flex direction="column" gap="3">
          <Text size="3" weight="medium">
            Behavior
          </Text>
          <Grid columns="2" gap="3">
            <Field label="Include threads across folders">
              <Select.Root
                value={(editingAccount.settings?.threading?.includeAcrossFolders ?? true) ? "yes" : "no"}
                onValueChange={(value) =>
                  onUpdateSettings({
                    threading: {
                      ...(editingAccount.settings?.threading ?? {}),
                      includeAcrossFolders: value === "yes"
                    }
                  })
                }
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content position="popper">
                  <Select.Item value="yes">Yes</Select.Item>
                  <Select.Item value="no">No</Select.Item>
                </Select.Content>
              </Select.Root>
            </Field>
          </Grid>
        </Flex>

        <Flex direction="column" gap="3">
          <Text size="3" weight="medium">
            Layout
          </Text>
          <Grid columns="2" gap="3">
            <Field label="Default layout">
              <Select.Root
                value={editingAccount.settings?.layout?.defaultView ?? "threads"}
                onValueChange={(value) =>
                  onUpdateSettings({
                    layout: {
                      ...(editingAccount.settings?.layout ?? {}),
                      defaultView: value as "card" | "table" | "compact" | "threads"
                    }
                  })
                }
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content position="popper">
                  <Select.Item value="threads">Thread view</Select.Item>
                  <Select.Item value="card">Card view</Select.Item>
                  <Select.Item value="table">Table view</Select.Item>
                  <Select.Item value="compact">Compact view</Select.Item>
                </Select.Content>
              </Select.Root>
            </Field>
          </Grid>
        </Flex>

        <Flex direction="column" gap="3">
          <Text size="3" weight="medium">
            Appearance
          </Text>
          <Grid columns="2" gap="3">
            <Field label="Date format" hint="Used in message list and message view.">
              <Select.Root
                value={normalizeAccountDateFormat(editingAccount.settings?.appearance?.dateFormat)}
                onValueChange={(value) =>
                  onUpdateSettings({
                    appearance: {
                      ...(editingAccount.settings?.appearance ?? {}),
                      dateFormat: value as AccountDateFormat
                    }
                  })
                }
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content position="popper">
                  {ACCOUNT_DATE_FORMAT_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field>
            <Field
              label="Sender icons"
              hint="Show remote sender logos or avatars when available."
            >
              <Flex asChild align="center" gap="2">
                <label>
                  <Switch
                    size="1"
                    checked={editingAccount.settings?.appearance?.senderIcons ?? true}
                    onCheckedChange={(checked) =>
                      onUpdateSettings({
                        appearance: {
                          ...(editingAccount.settings?.appearance ?? {}),
                          senderIcons: checked
                        }
                      })
                    }
                  />
                  <Text size="2">Show sender icons</Text>
                </label>
              </Flex>
            </Field>
          </Grid>
        </Flex>

        {isAdminUser && (
          <Flex direction="column" gap="3">
            <Text size="3" weight="medium">
              Performance
            </Text>
            <Text size="1" color="gray">
              Controls IMAP polling cadence and how many folders stay on IDLE.
            </Text>
            <Grid columns="2" gap="3">
              <Field label="Max idle sessions" hint="Number of folders kept on IMAP IDLE simultaneously.">
                <TextField.Root
                  type="number"
                  min={1}
                  placeholder="Default: 3"
                  value={editingAccount.settings?.sync?.maxIdleSessions ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    onUpdateSettings({
                      sync: {
                        ...(editingAccount.settings?.sync ?? {}),
                        maxIdleSessions: value === "" ? undefined : Number(value)
                      }
                    });
                  }}
                />
              </Field>
              <Field
                label="Background folder poll (ms)"
                hint="How often non-INBOX folders are checked for updates."
              >
                <TextField.Root
                  type="number"
                  min={10000}
                  step={1000}
                  placeholder="Default: 900000"
                  value={editingAccount.settings?.sync?.backgroundPollIntervalMs ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    onUpdateSettings({
                      sync: {
                        ...(editingAccount.settings?.sync ?? {}),
                        backgroundPollIntervalMs: value === "" ? undefined : Number(value)
                      }
                    });
                  }}
                />
              </Field>
              <Field
                label="INBOX poll fallback (ms)"
                hint="Used when stream/IDLE is unavailable (e.g. hidden tab/network issues)."
              >
                <TextField.Root
                  type="number"
                  min={10000}
                  step={1000}
                  placeholder="Default: 300000"
                  value={editingAccount.settings?.sync?.pollIntervalMs ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    onUpdateSettings({
                      sync: {
                        ...(editingAccount.settings?.sync ?? {}),
                        pollIntervalMs: value === "" ? undefined : Number(value)
                      }
                    });
                  }}
                />
              </Field>
            </Grid>
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
