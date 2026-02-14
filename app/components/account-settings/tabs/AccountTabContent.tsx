import { Button, Flex, Grid, Select, Text, TextField } from "@radix-ui/themes";
import PasswordField from "@/app/components/PasswordField";
import Field from "@/app/components/account-settings/Field";
import type { Account } from "@/lib/data";

type Props = {
  editingAccount: Account;
  isExistingAccount: boolean;
  imapDetecting: boolean;
  smtpDetecting: boolean;
  imapProbe: { tls?: boolean; starttls?: boolean } | null;
  smtpProbe: { tls?: boolean; starttls?: boolean } | null;
  imapSecurity: "tls" | "starttls" | "none";
  smtpSecurity: "tls" | "starttls" | "none";
  onImapSecurityChange: (value: "tls" | "starttls" | "none") => void;
  onSmtpSecurityChange: (value: "tls" | "starttls" | "none") => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onUpdateAccount: (next: Account) => void;
  onRunProbe: (protocol: "imap" | "smtp") => void;
};

export default function AccountTabContent({
  editingAccount,
  isExistingAccount,
  imapDetecting,
  smtpDetecting,
  imapProbe,
  smtpProbe,
  imapSecurity,
  smtpSecurity,
  onImapSecurityChange,
  onSmtpSecurityChange,
  onClose,
  onSave,
  onDelete,
  onUpdateAccount,
  onRunProbe
}: Props) {
  return (
    <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
      <Flex direction="column" gap="4" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <Text size="2" color="gray">
          Manage IMAP/SMTP credentials for syncing and sending.
        </Text>
        <Flex direction="column" gap="3">
          <Text size="3" weight="medium">
            Account details
          </Text>
          <Grid columns="2" gap="3">
            <Field label="Name">
              <TextField.Root
                value={editingAccount.name}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    name: event.target.value
                  })
                }
              />
            </Field>
            <Field label="Email">
              <TextField.Root
                value={editingAccount.email}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    email: event.target.value
                  })
                }
              />
            </Field>
          </Grid>
        </Flex>

        <Flex direction="column" gap="3">
          <Flex align="center" justify="between">
            <Text size="3" weight="medium">
              IMAP (Incoming Server)
            </Text>
            <Button size="1" variant="soft" onClick={() => onRunProbe("imap")} disabled={imapDetecting}>
              {imapDetecting ? "Detecting..." : "Detect security"}
            </Button>
          </Flex>
          {imapProbe && (
            <Text size="1" color="gray">
              TLS: {imapProbe.tls ? "Yes" : "No"} · STARTTLS: {imapProbe.starttls ? "Yes" : "No"}
            </Text>
          )}
          <Grid columns="3fr 1fr 2fr" gap="3">
            <Field label="IMAP host">
              <TextField.Root
                value={editingAccount.imap.host}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    imap: { ...editingAccount.imap, host: event.target.value }
                  })
                }
              />
            </Field>
            <Field label="IMAP port">
              <TextField.Root
                type="number"
                value={editingAccount.imap.port}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    imap: {
                      ...editingAccount.imap,
                      port: Number(event.target.value)
                    }
                  })
                }
              />
            </Field>
            <Field label="Security">
              <Select.Root
                value={imapSecurity}
                onValueChange={(value) => {
                  const next = value as "tls" | "starttls" | "none";
                  const port = next === "tls" ? 993 : 143;
                  onImapSecurityChange(next);
                  onUpdateAccount({
                    ...editingAccount,
                    imap: { ...editingAccount.imap, secure: next === "tls", port }
                  });
                }}
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content position="popper">
                  {(imapProbe?.tls ?? true) && <Select.Item value="tls">TLS (implicit)</Select.Item>}
                  {(imapProbe?.starttls ?? true) && (
                    <Select.Item value="starttls">STARTTLS</Select.Item>
                  )}
                  <Select.Item value="none">None</Select.Item>
                </Select.Content>
              </Select.Root>
            </Field>
          </Grid>
          <Grid columns={{ initial: "1", sm: "2" }} gap="3">
            <Field label="IMAP user">
              <TextField.Root
                value={editingAccount.imap.user}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    imap: { ...editingAccount.imap, user: event.target.value }
                  })
                }
              />
            </Field>
            <Field label="IMAP password">
              <PasswordField
                value={editingAccount.imap.password}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    imap: {
                      ...editingAccount.imap,
                      password: event.target.value
                    }
                  })
                }
              />
            </Field>
          </Grid>
        </Flex>

        <Flex direction="column" gap="3">
          <Flex align="center" justify="between">
            <Text size="3" weight="medium">
              SMTP (Outgoing Server)
            </Text>
            <Button size="1" variant="soft" onClick={() => onRunProbe("smtp")} disabled={smtpDetecting}>
              {smtpDetecting ? "Detecting..." : "Detect security"}
            </Button>
          </Flex>
          {smtpProbe && (
            <Text size="1" color="gray">
              TLS: {smtpProbe.tls ? "Yes" : "No"} · STARTTLS: {smtpProbe.starttls ? "Yes" : "No"}
            </Text>
          )}
          <Grid columns="3fr 1fr 2fr" gap="3">
            <Field label="SMTP host">
              <TextField.Root
                value={editingAccount.smtp.host}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    smtp: { ...editingAccount.smtp, host: event.target.value }
                  })
                }
              />
            </Field>
            <Field label="SMTP port">
              <TextField.Root
                type="number"
                value={editingAccount.smtp.port}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    smtp: {
                      ...editingAccount.smtp,
                      port: Number(event.target.value)
                    }
                  })
                }
              />
            </Field>
            <Field label="Security">
              <Select.Root
                value={smtpSecurity}
                onValueChange={(value) => {
                  const next = value as "tls" | "starttls" | "none";
                  const port = next === "tls" ? 465 : next === "starttls" ? 587 : 25;
                  onSmtpSecurityChange(next);
                  onUpdateAccount({
                    ...editingAccount,
                    smtp: { ...editingAccount.smtp, secure: next === "tls", port }
                  });
                }}
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content position="popper">
                  {(smtpProbe?.tls ?? true) && <Select.Item value="tls">TLS (implicit)</Select.Item>}
                  {(smtpProbe?.starttls ?? true) && (
                    <Select.Item value="starttls">STARTTLS</Select.Item>
                  )}
                  <Select.Item value="none">None</Select.Item>
                </Select.Content>
              </Select.Root>
            </Field>
          </Grid>
          <Grid columns={{ initial: "1", sm: "2" }} gap="3">
            <Field label="SMTP user">
              <TextField.Root
                value={editingAccount.smtp.user}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    smtp: { ...editingAccount.smtp, user: event.target.value }
                  })
                }
              />
            </Field>
            <Field label="SMTP password">
              <PasswordField
                value={editingAccount.smtp.password}
                onChange={(event) =>
                  onUpdateAccount({
                    ...editingAccount,
                    smtp: {
                      ...editingAccount.smtp,
                      password: event.target.value
                    }
                  })
                }
              />
            </Field>
          </Grid>
        </Flex>
      </Flex>

      <Flex
        justify="between"
        align="center"
        gap="3"
        wrap="wrap"
        style={{ paddingTop: "var(--space-3)", borderTop: "1px solid var(--gray-a5)" }}
      >
        <Button size="2" color="red" variant="soft" onClick={onDelete} disabled={!isExistingAccount}>
          Delete Account
        </Button>
        <Flex gap="3" align="center">
          <Button size="2" variant="soft" color="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button size="2" onClick={onSave}>
            Save
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
