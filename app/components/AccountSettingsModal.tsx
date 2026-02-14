import { X } from "lucide-react";
import { Dialog, Flex, IconButton, Tabs } from "@radix-ui/themes";
import type { Account, AccountSettings } from "@/lib/data";
import AccountTabContent from "@/app/components/account-settings/tabs/AccountTabContent";
import SignaturesTabContent from "@/app/components/account-settings/tabs/SignaturesTabContent";
import PreferencesTabContent from "@/app/components/account-settings/tabs/PreferencesTabContent";
import CategorizationTabContent from "@/app/components/account-settings/tabs/CategorizationTabContent";
import AdminTabContent from "@/app/components/account-settings/tabs/AdminTabContent";

export type ManageTab = "account" | "signatures" | "preferences" | "categorization" | "admin";

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
  isAdminUser?: boolean;
  onNotifySuccess?: (title: string, description: string) => void;
  apiFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage?: (res: Response) => Promise<string>;
};

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
  isAdminUser = false,
  onNotifySuccess,
  apiFetch,
  readErrorMessage
}: Props) {
  if (!isOpen) return null;

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
              {isAdminUser && (
                <Tabs.Trigger value="admin" disabled={!isExistingAccount}>
                  Admin
                </Tabs.Trigger>
              )}
            </Tabs.List>

            <Tabs.Content value="account" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <AccountTabContent
                editingAccount={editingAccount}
                isExistingAccount={isExistingAccount}
                imapDetecting={imapDetecting}
                smtpDetecting={smtpDetecting}
                imapProbe={imapProbe}
                smtpProbe={smtpProbe}
                imapSecurity={imapSecurity}
                smtpSecurity={smtpSecurity}
                onImapSecurityChange={onImapSecurityChange}
                onSmtpSecurityChange={onSmtpSecurityChange}
                onClose={onClose}
                onSave={onSave}
                onDelete={onDelete}
                onUpdateAccount={onUpdateAccount}
                onRunProbe={onRunProbe}
              />
            </Tabs.Content>

            <Tabs.Content value="signatures" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <SignaturesTabContent
                editingAccount={editingAccount}
                isExistingAccount={isExistingAccount}
                onUpdateSettings={onUpdateSettings}
                onClose={onClose}
                onSave={onSave}
              />
            </Tabs.Content>

            <Tabs.Content value="preferences" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <PreferencesTabContent
                editingAccount={editingAccount}
                isExistingAccount={isExistingAccount}
                onUpdateSettings={onUpdateSettings}
                onClose={onClose}
                onSave={onSave}
              />
            </Tabs.Content>

            <Tabs.Content value="categorization" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <CategorizationTabContent
                accountId={editingAccount.id}
                isActive={manageTab === "categorization"}
                isExistingAccount={isExistingAccount}
                onClose={onClose}
                onSave={onSave}
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

            <Tabs.Content value="admin" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
              <AdminTabContent
                isActive={manageTab === "admin"}
                isAdminUser={isAdminUser}
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
