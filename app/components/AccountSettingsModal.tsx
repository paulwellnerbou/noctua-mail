import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Dialog, Flex, IconButton, Tabs } from "@radix-ui/themes";
import type { Account, AccountSettings, RecipientAlias, Topic } from "@/lib/data";
import { hasSavableAccountSettingsChanges } from "@/lib/accountSettings";
import AccountTabContent from "@/app/components/account-settings/tabs/AccountTabContent";
import SignaturesTabContent from "@/app/components/account-settings/tabs/SignaturesTabContent";
import PreferencesTabContent from "@/app/components/account-settings/tabs/PreferencesTabContent";
import CategorizationTabContent from "@/app/components/account-settings/tabs/CategorizationTabContent";
import AdminTabContent from "@/app/components/account-settings/tabs/AdminTabContent";
import CalendarTabContent from "@/app/components/account-settings/tabs/CalendarTabContent";
import TopicsTabContent from "@/app/components/account-settings/tabs/TopicsTabContent";
import RecipientAliasesTabContent from "@/app/components/account-settings/tabs/RecipientAliasesTabContent";
import McpTabContent from "@/app/components/account-settings/tabs/McpTabContent";
export type ManageTab =
  | "account"
  | "signatures"
  | "preferences"
  | "categorization"
  | "calendar"
  | "topics"
  | "mcp"
  | "recipient-aliases"
  | "admin";

function deriveImapSecurity(imap: Account["imap"]): "tls" | "starttls" | "none" {
  if (imap.secure) return "tls";
  return imap.port === 143 ? "starttls" : "none";
}

function deriveSmtpSecurity(smtp: Account["smtp"]): "tls" | "starttls" | "none" {
  if (smtp.secure) return "tls";
  if (smtp.port === 587) return "starttls";
  return "none";
}

type Props = {
  editingAccount: Account;
  isOpen: boolean;
  manageTab: ManageTab;
  isExistingAccount: boolean;
  onClose: () => void;
  onTabChange: (tab: ManageTab) => void;
  onSave: (account: Account) => void;
  onDelete: () => void;
  isAdminUser?: boolean;
  onNotifySuccess?: (title: string, description: string) => void;
  apiFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage?: (res: Response) => Promise<string>;
  onTopicsChanged?: (topics: Topic[]) => void;
  recipientAliases?: RecipientAlias[];
  onRecipientAliasesChanged?: (aliases: RecipientAlias[]) => void;
  onCreateRecipientAlias?: (name: string, recipients: string) => Promise<RecipientAlias>;
  onUpdateRecipientAlias?: (
    aliasId: string,
    name: string,
    recipients: string
  ) => Promise<RecipientAlias>;
  onDeleteRecipientAlias?: (aliasId: string) => Promise<void>;
};

export default function AccountSettingsModal({
  editingAccount: initialAccount,
  isOpen,
  manageTab,
  isExistingAccount,
  onClose,
  onTabChange,
  onSave,
  onDelete,
  isAdminUser = false,
  onNotifySuccess,
  apiFetch,
  readErrorMessage,
  onTopicsChanged,
  recipientAliases = [],
  onRecipientAliasesChanged,
  onCreateRecipientAlias,
  onUpdateRecipientAlias,
  onDeleteRecipientAlias
}: Props) {
  const [localAccount, setLocalAccount] = useState<Account>(initialAccount);
  const [imapSecurity, setImapSecurity] = useState<"tls" | "starttls" | "none">(() =>
    deriveImapSecurity(initialAccount.imap)
  );
  const [smtpSecurity, setSmtpSecurity] = useState<"tls" | "starttls" | "none">(() =>
    deriveSmtpSecurity(initialAccount.smtp)
  );
  const [imapDetecting, setImapDetecting] = useState(false);
  const [smtpDetecting, setSmtpDetecting] = useState(false);
  const [imapProbe, setImapProbe] = useState<{ tls?: boolean; starttls?: boolean } | null>(null);
  const [smtpProbe, setSmtpProbe] = useState<{ tls?: boolean; starttls?: boolean } | null>(null);

  const fetchFn = apiFetch ?? fetch;

  const handleSave = () => onSave(localAccount);

  const canSaveAccountTab = useMemo(
    () =>
      hasSavableAccountSettingsChanges(initialAccount, localAccount, "account", { isAdminUser }) &&
      Boolean(localAccount.email?.trim()),
    [initialAccount, isAdminUser, localAccount]
  );
  const canSaveSignaturesTab = useMemo(
    () => hasSavableAccountSettingsChanges(initialAccount, localAccount, "signatures", { isAdminUser }),
    [initialAccount, isAdminUser, localAccount]
  );
  const canSavePreferencesTab = useMemo(
    () => hasSavableAccountSettingsChanges(initialAccount, localAccount, "preferences", { isAdminUser }),
    [initialAccount, isAdminUser, localAccount]
  );
  const canSaveCalendarTab = useMemo(
    () => hasSavableAccountSettingsChanges(initialAccount, localAccount, "calendar", { isAdminUser }),
    [initialAccount, isAdminUser, localAccount]
  );
  const canSaveTopicsTab = useMemo(
    () => hasSavableAccountSettingsChanges(initialAccount, localAccount, "topics", { isAdminUser }),
    [initialAccount, isAdminUser, localAccount]
  );

  if (!isOpen) return null;

  const handleUpdateSettings = (next: AccountSettings) => {
    setLocalAccount((prev) => ({
      ...prev,
      settings: { ...(prev.settings ?? {}), ...next }
    }));
  };

  const runProbe = async (protocol: "imap" | "smtp") => {
    if (protocol === "imap") setImapDetecting(true);
    if (protocol === "smtp") setSmtpDetecting(true);
    const config = protocol === "imap" ? localAccount.imap : localAccount.smtp;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetchFn("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocol, host: config.host, port: config.port }),
        signal: controller.signal
      });
      if (!response.ok) return;
      const data = (await response.json()) as { supportsTLS: boolean; supportsStartTLS: boolean };
      if (protocol === "imap") {
        setImapProbe({ tls: data.supportsTLS, starttls: data.supportsStartTLS });
        if (data.supportsTLS) {
          setImapSecurity("tls");
          setLocalAccount((prev) => ({ ...prev, imap: { ...prev.imap, secure: true, port: 993 } }));
        } else if (data.supportsStartTLS) {
          setImapSecurity("starttls");
          setLocalAccount((prev) => ({ ...prev, imap: { ...prev.imap, secure: false, port: 143 } }));
        } else {
          setImapSecurity("none");
          setLocalAccount((prev) => ({ ...prev, imap: { ...prev.imap, secure: false, port: 143 } }));
        }
      } else {
        setSmtpProbe({ tls: data.supportsTLS, starttls: data.supportsStartTLS });
        if (data.supportsTLS) {
          setSmtpSecurity("tls");
          setLocalAccount((prev) => ({ ...prev, smtp: { ...prev.smtp, secure: true, port: 465 } }));
        } else if (data.supportsStartTLS) {
          setSmtpSecurity("starttls");
          setLocalAccount((prev) => ({ ...prev, smtp: { ...prev.smtp, secure: false, port: 587 } }));
        } else {
          setSmtpSecurity("none");
          setLocalAccount((prev) => ({ ...prev, smtp: { ...prev.smtp, secure: false, port: 25 } }));
        }
      }
    } finally {
      window.clearTimeout(timer);
      setImapDetecting(false);
      setSmtpDetecting(false);
    }
  };

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        className="account-settings-modal"
        size="4"
        width="94vw"
        maxWidth="980px"
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        style={{
          height: "min(86vh, 900px)",
          overflow: "hidden"
        }}
      >
        <Flex direction="column" gap="4" style={{ height: "100%", minHeight: 0 }}>
          <Flex align="center" justify="between" style={{ paddingBottom: "var(--space-2)", flexShrink: 0 }}>
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
              <Tabs.Trigger value="topics" disabled={!isExistingAccount}>
                Topics
              </Tabs.Trigger>
              <Tabs.Trigger value="calendar" disabled={!isExistingAccount}>
                Calendar
              </Tabs.Trigger>
              <Tabs.Trigger value="recipient-aliases" disabled={!isExistingAccount}>
                Recipient Aliases
              </Tabs.Trigger>
              <Tabs.Trigger value="mcp" disabled={!isExistingAccount}>
                MCP
              </Tabs.Trigger>
              {isAdminUser && (
                <Tabs.Trigger value="admin" disabled={!isExistingAccount}>
                  Admin
                </Tabs.Trigger>
              )}
            </Tabs.List>

            <Tabs.Content value="account" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <AccountTabContent
                editingAccount={localAccount}
                isExistingAccount={isExistingAccount}
                imapDetecting={imapDetecting}
                smtpDetecting={smtpDetecting}
                imapProbe={imapProbe}
                smtpProbe={smtpProbe}
                imapSecurity={imapSecurity}
                smtpSecurity={smtpSecurity}
                onImapSecurityChange={setImapSecurity}
                onSmtpSecurityChange={setSmtpSecurity}
                onClose={onClose}
                onSave={handleSave}
                onDelete={onDelete}
                canSave={canSaveAccountTab}
                onUpdateAccount={setLocalAccount}
                onRunProbe={runProbe}
              />
            </Tabs.Content>

            <Tabs.Content value="signatures" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <SignaturesTabContent
                editingAccount={localAccount}
                isExistingAccount={isExistingAccount}
                onUpdateSettings={handleUpdateSettings}
                onClose={onClose}
                onSave={handleSave}
                canSave={canSaveSignaturesTab}
              />
            </Tabs.Content>

            <Tabs.Content value="preferences" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <PreferencesTabContent
                editingAccount={localAccount}
                isExistingAccount={isExistingAccount}
                isAdminUser={isAdminUser}
                onUpdateSettings={handleUpdateSettings}
                onClose={onClose}
                onSave={handleSave}
                canSave={canSavePreferencesTab}
              />
            </Tabs.Content>

            <Tabs.Content value="categorization" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <CategorizationTabContent
                accountId={localAccount.id}
                isActive={manageTab === "categorization"}
                isExistingAccount={isExistingAccount}
                accountDateFormat={localAccount.settings?.appearance?.dateFormat}
                onClose={onClose}
                onSave={handleSave}
                onModelResetSuccess={() =>
                  onNotifySuccess?.(
                    "Categorization model reset",
                    "Default baseline model restored for this account."
                  )
                }
                apiFetch={apiFetch}
                readErrorMessage={readErrorMessage}
              />
            </Tabs.Content>

            <Tabs.Content value="calendar" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <CalendarTabContent
                editingAccount={localAccount}
                isExistingAccount={isExistingAccount}
                onUpdateAccount={setLocalAccount}
                onClose={onClose}
                onSave={handleSave}
                canSave={canSaveCalendarTab}
              />
            </Tabs.Content>

            <Tabs.Content value="topics" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "var(--space-2)" }}>
              <TopicsTabContent
                accountId={localAccount.id}
                isActive={manageTab === "topics"}
                isExistingAccount={isExistingAccount}
                apiFetch={apiFetch}
                onTopicsChanged={onTopicsChanged}
                topicColorRows={localAccount.settings?.appearance?.topicColorRows ?? true}
                onUpdateSettings={handleUpdateSettings}
                currentAppearance={localAccount.settings?.appearance}
                onClose={onClose}
                onSave={handleSave}
                canSave={canSaveTopicsTab}
              />
            </Tabs.Content>

            <Tabs.Content
              value="mcp"
              style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}
            >
              <McpTabContent
                accountId={localAccount.id}
                isActive={manageTab === "mcp"}
                isExistingAccount={isExistingAccount}
                accountDateFormat={localAccount.settings?.appearance?.dateFormat}
                apiFetch={apiFetch}
                onClose={onClose}
              />
            </Tabs.Content>

            <Tabs.Content
              value="recipient-aliases"
              style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "var(--space-2)" }}
            >
              <RecipientAliasesTabContent
                accountId={localAccount.id}
                isExistingAccount={isExistingAccount}
                aliases={recipientAliases}
                apiFetch={apiFetch}
                onCreateAlias={onCreateRecipientAlias ?? (async () => {
                  throw new Error("Recipient alias creation is unavailable.");
                })}
                onUpdateAlias={onUpdateRecipientAlias ?? (async () => {
                  throw new Error("Recipient alias update is unavailable.");
                })}
                onDeleteAlias={onDeleteRecipientAlias ?? (async () => {
                  throw new Error("Recipient alias deletion is unavailable.");
                })}
                onAliasesChanged={onRecipientAliasesChanged}
                onClose={onClose}
              />
            </Tabs.Content>

            <Tabs.Content value="admin" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <AdminTabContent
                isActive={manageTab === "admin"}
                isAdminUser={isAdminUser}
                accountDateFormat={localAccount.settings?.appearance?.dateFormat}
                onClose={onClose}
                onInviteGenerated={() =>
                  onNotifySuccess?.(
                    "Invite code generated",
                    "A one-time invite code for a new user is ready."
                  )
                }
                apiFetch={apiFetch}
                readErrorMessage={readErrorMessage}
              />
            </Tabs.Content>

          </Tabs.Root>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
