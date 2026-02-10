import type { ReactNode } from "react";
import { X } from "lucide-react";
import {
  Button,
  Card,
  Dialog,
  Flex,
  Grid,
  IconButton,
  Select,
  Tabs,
  Text,
  TextArea,
  TextField
} from "@radix-ui/themes";
import PasswordField from "@/app/components/PasswordField";
import type { Account, AccountDateFormat, AccountSettings } from "@/lib/data";
import {
  ACCOUNT_DATE_FORMAT_OPTIONS,
  normalizeAccountDateFormat
} from "@/lib/dateFormatting";
import type { CategoryLearningDebugSnapshot } from "@/lib/mail/categorization/debugTypes";

export type ManageTab = "account" | "signatures" | "preferences" | "categorization";

type Props = {
  editingAccount: Account;
  isOpen: boolean;
  manageTab: ManageTab;
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
  onTabChange: (tab: ManageTab) => void;
  onSave: () => void;
  onDelete: () => void;
  onUpdateAccount: (next: Account) => void;
  onUpdateSettings: (next: AccountSettings) => void;
  onRunProbe: (protocol: "imap" | "smtp") => void;
  categorizationDebug?: CategoryLearningDebugSnapshot | null;
  categorizationLoading?: boolean;
  categorizationError?: string | null;
  onRefreshCategorization?: () => void;
};

type FieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

function Field({ label, hint, children }: FieldProps) {
  return (
    <Flex direction="column" gap="1">
      <Text size="2" weight="medium">
        {label}
      </Text>
      {children}
      {hint && (
        <Text size="1" color="gray">
          {hint}
        </Text>
      )}
    </Flex>
  );
}

export default function AccountSettingsModal({
  editingAccount,
  isOpen,
  manageTab,
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
  onTabChange,
  onSave,
  onDelete,
  onUpdateAccount,
  onUpdateSettings,
  onRunProbe,
  categorizationDebug,
  categorizationLoading = false,
  categorizationError,
  onRefreshCategorization
}: Props) {
  if (!isOpen) return null;
  const signatures = editingAccount.settings?.signatures ?? [];
  const formatTimestamp = (value?: number | null) => {
    if (!value || !Number.isFinite(value)) return "Never";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "Never";
    }
  };
  const formatCategory = (value: string | null) => {
    if (!value) return "none";
    if (value === "newsletter") return "newsletter";
    if (value === "notification") return "notification";
    if (value === "transactional") return "transactional";
    return value;
  };
  const categoryLabels: Array<"newsletter" | "notification" | "transactional"> = [
    "newsletter",
    "notification",
    "transactional"
  ];

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
        <Dialog.Content
          size="4"
          width="94vw"
          maxWidth="980px"
          style={{
            height: "min(86vh, 900px)",
            overflow: "hidden"
          }}
        >
        <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
          <Flex
            align="center"
            justify="between"
            style={{ paddingBottom: "var(--space-2)", flexShrink: 0 }}
          >
            <Dialog.Title size="5" weight="bold">
              Account settings
            </Dialog.Title>
            <IconButton variant="ghost" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </Flex>

          <Tabs.Root
            value={manageTab}
            onValueChange={(value) => onTabChange(value as ManageTab)}
            style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <Tabs.List style={{ marginBottom: "var(--space-4)", flexShrink: 0 }}>
              <Tabs.Trigger value="account">Account</Tabs.Trigger>
              <Tabs.Trigger value="signatures" disabled={!isExistingAccount}>
                Signatures
              </Tabs.Trigger>
              <Tabs.Trigger value="preferences" disabled={!isExistingAccount}>
                Preferences
              </Tabs.Trigger>
              <Tabs.Trigger value="categorization" disabled={!isExistingAccount}>
                Categorization
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content
              value="account"
              style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}
            >
              <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
                <Flex
                  direction="column"
                  gap="4"
                  style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}
                >
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
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() => onRunProbe("imap")}
                        disabled={imapDetecting}
                      >
                        {imapDetecting ? "Detecting..." : "Detect security"}
                      </Button>
                    </Flex>
                    {imapProbe && (
                      <Text size="1" color="gray">
                        TLS: {imapProbe.tls ? "Yes" : "No"} · STARTTLS:{" "}
                        {imapProbe.starttls ? "Yes" : "No"}
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
                            {(imapProbe?.tls ?? true) && (
                              <Select.Item value="tls">TLS (implicit)</Select.Item>
                            )}
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
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() => onRunProbe("smtp")}
                        disabled={smtpDetecting}
                      >
                        {smtpDetecting ? "Detecting..." : "Detect security"}
                      </Button>
                    </Flex>
                    {smtpProbe && (
                      <Text size="1" color="gray">
                        TLS: {smtpProbe.tls ? "Yes" : "No"} · STARTTLS:{" "}
                        {smtpProbe.starttls ? "Yes" : "No"}
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
                            {(smtpProbe?.tls ?? true) && (
                              <Select.Item value="tls">TLS (implicit)</Select.Item>
                            )}
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
                  <Button
                    size="2"
                    color="red"
                    variant="soft"
                    onClick={onDelete}
                    disabled={!isExistingAccount}
                  >
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
            </Tabs.Content>

            <Tabs.Content
              value="signatures"
              style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}
            >
              <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
                <Flex
                  direction="column"
                  gap="4"
                  style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}
                >
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
                                  entry.id === signature.id
                                    ? { ...entry, name: event.target.value }
                                    : entry
                                );
                                onUpdateSettings({ signatures: nextSignatures });
                              }}
                            />
                          </Field>
                            <Field label="Signature text">
                              <TextArea
                                rows={4}
                                value={signature.body}
                                onChange={(event) => {
                                  const nextSignatures = signatures.map((entry) =>
                                    entry.id === signature.id
                                      ? { ...entry, body: event.target.value }
                                      : entry
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
                                  const nextSignatures = signatures.filter(
                                    (entry) => entry.id !== signature.id
                                  );
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
                  <Button size="2" onClick={onSave} disabled={!isExistingAccount}>
                    Save
                  </Button>
                </Flex>
              </Flex>
            </Tabs.Content>

            <Tabs.Content
              value="preferences"
              style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}
            >
              <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
                <Flex
                  direction="column"
                  gap="4"
                  style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}
                >
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
                          value={
                            (editingAccount.settings?.threading?.includeAcrossFolders ?? true)
                              ? "yes"
                              : "no"
                          }
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
                      <Field
                        label="Date format"
                        hint="Used in message list and message view."
                      >
                        <Select.Root
                          value={normalizeAccountDateFormat(
                            editingAccount.settings?.appearance?.dateFormat
                          )}
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
                    </Grid>
                  </Flex>

                  <Flex direction="column" gap="3">
                    <Text size="3" weight="medium">
                      Performance
                    </Text>
                    <Text size="1" color="gray">
                      Controls IMAP polling and how many folders stay on IDLE.
                    </Text>
                    <Grid columns="2" gap="3">
                      <Field
                        label="Max idle sessions"
                        hint="Number of folders kept on IMAP IDLE simultaneously."
                      >
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
                        label="Poll interval (ms)"
                        hint="Frequency for background folder status checks."
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
                  <Button size="2" onClick={onSave} disabled={!isExistingAccount}>
                    Save
                  </Button>
                </Flex>
              </Flex>
            </Tabs.Content>

            <Tabs.Content
              value="categorization"
              style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}
            >
              <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
                <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
                  <Flex direction="column" gap="4">
                    <Flex align="center" justify="between" gap="3" wrap="wrap">
                      <Text size="2" color="gray">
                        Inspect learned category calibration and recent feedback events for this account.
                      </Text>
                      <Button
                        size="1"
                        variant="soft"
                        onClick={onRefreshCategorization}
                        disabled={!onRefreshCategorization || categorizationLoading}
                      >
                        {categorizationLoading ? "Refreshing..." : "Refresh"}
                      </Button>
                    </Flex>

                    {categorizationError && (
                      <Card size="2">
                        <Text size="2" color="red">
                          {categorizationError}
                        </Text>
                      </Card>
                    )}

                    <Card size="2">
                      <Flex direction="column" gap="2">
                        <Text size="3" weight="medium">
                          Model
                        </Text>
                        {categorizationDebug?.model ? (
                          <Grid columns={{ initial: "1", sm: "2" }} gap="2">
                            <Text size="2">Version: {categorizationDebug.model.version}</Text>
                            <Text size="2">Examples: {categorizationDebug.model.examples}</Text>
                            <Text size="2">
                              Updated: {formatTimestamp(categorizationDebug.model.updatedAt)}
                            </Text>
                            <Text size="2">
                              Learning rate: {categorizationDebug.model.learningRate}
                            </Text>
                            <Text size="2">L2: {categorizationDebug.model.l2}</Text>
                            <Text size="2">
                              Features:{" "}
                              {categoryLabels
                                .map(
                                  (category) =>
                                    `${category}=${categorizationDebug.model?.featureCounts[category] ?? 0}`
                                )
                                .join(" · ")}
                            </Text>
                          </Grid>
                        ) : (
                          <Text size="2" color="gray">
                            No learned model yet. Use message menu category actions to create feedback events.
                          </Text>
                        )}
                      </Flex>
                    </Card>

                    <Card size="2">
                      <Flex direction="column" gap="2">
                        <Text size="3" weight="medium">
                          Category Distribution
                        </Text>
                        <Flex direction="column" gap="1">
                          {(categorizationDebug?.categoryCounts ?? []).map((entry) => (
                            <Text key={entry.category} size="2">
                              {entry.category}: {entry.count}
                            </Text>
                          ))}
                        </Flex>
                        <Text size="2">
                          Manual category overrides: {categorizationDebug?.manualCategorizedCount ?? 0}
                        </Text>
                      </Flex>
                    </Card>

                    <Card size="2">
                      <Flex direction="column" gap="2">
                        <Text size="3" weight="medium">
                          Feedback Events
                        </Text>
                        <Text size="2">
                          Total: {categorizationDebug?.feedback.totalEvents ?? 0} · Last:{" "}
                          {formatTimestamp(categorizationDebug?.feedback.lastEventAt)}
                        </Text>
                        <Text size="2" weight="medium">
                          Top transitions
                        </Text>
                        <Flex direction="column" gap="1">
                          {(categorizationDebug?.feedback.transitions ?? []).slice(0, 8).map((entry) => (
                            <Text
                              key={`${entry.previousCategory ?? "none"}-${entry.nextCategory ?? "none"}-${entry.count}`}
                              size="2"
                            >
                              {formatCategory(entry.previousCategory)} → {formatCategory(entry.nextCategory)}:{" "}
                              {entry.count}
                            </Text>
                          ))}
                        </Flex>
                        <Text size="2" weight="medium">
                          Recent events
                        </Text>
                        <Flex direction="column" gap="1">
                          {(categorizationDebug?.feedback.recent ?? []).map((entry) => (
                            <Text
                              key={`${entry.createdAt}-${entry.messageId}-${entry.previousCategory ?? "none"}-${entry.nextCategory ?? "none"}`}
                              size="2"
                            >
                              {formatTimestamp(entry.createdAt)} · {formatCategory(entry.previousCategory)} →{" "}
                              {formatCategory(entry.nextCategory)} · features: {entry.featureCount}
                            </Text>
                          ))}
                          {(categorizationDebug?.feedback.recent ?? []).length === 0 && (
                            <Text size="2" color="gray">
                              No feedback events yet.
                            </Text>
                          )}
                        </Flex>
                      </Flex>
                    </Card>

                    <Card size="2">
                      <Flex direction="column" gap="2">
                        <Text size="3" weight="medium">
                          Top Learned Features
                        </Text>
                        {!categorizationDebug?.model ? (
                          <Text size="2" color="gray">
                            No model weights available.
                          </Text>
                        ) : (
                          <Grid columns={{ initial: "1", sm: "3" }} gap="3">
                            {categoryLabels.map((category) => (
                              <Flex key={category} direction="column" gap="1">
                                <Text size="2" weight="medium">
                                  {category}
                                </Text>
                                {categorizationDebug.model?.topWeights[category].length ? (
                                  categorizationDebug.model.topWeights[category].map((entry) => (
                                    <Text
                                      key={`${category}-${entry.feature}`}
                                      size="1"
                                      color="gray"
                                      style={{ overflowWrap: "anywhere" }}
                                    >
                                      {entry.feature}: {entry.weight >= 0 ? "+" : ""}
                                      {entry.weight}
                                    </Text>
                                  ))
                                ) : (
                                  <Text size="1" color="gray">
                                    No features
                                  </Text>
                                )}
                              </Flex>
                            ))}
                          </Grid>
                        )}
                      </Flex>
                    </Card>
                  </Flex>
                </div>

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
                  <Button size="2" onClick={onSave} disabled={!isExistingAccount}>
                    Save
                  </Button>
                </Flex>
              </Flex>
            </Tabs.Content>
          </Tabs.Root>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
