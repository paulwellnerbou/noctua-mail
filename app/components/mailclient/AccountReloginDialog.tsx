"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Callout, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import Field from "@/app/components/account-settings/Field";
import PasswordField from "@/app/components/PasswordField";
import { buildAccountReloginPath } from "@/lib/accountApiPaths";
import type { Account } from "@/lib/data";

type Props = {
  open: boolean;
  account: Account | null;
  title?: string;
  description?: string;
  apiFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage: (res: Response) => Promise<string>;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (account: Account) => void | Promise<void>;
};

export default function AccountReloginDialog({
  open,
  account,
  title = "Mailbox credentials required",
  description,
  apiFetch,
  readErrorMessage,
  onOpenChange,
  onSuccess
}: Props) {
  const fetchFn = apiFetch ?? fetch;
  const [imapUser, setImapUser] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !account) return;
    setImapUser(account.imap.user || account.email || "");
    setImapPassword("");
    setError("");
    setSubmitting(false);
  }, [account, open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetchFn(buildAccountReloginPath(account.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imap: {
            user: imapUser,
            password: imapPassword
          }
        })
      });
      if (!response.ok) {
        setError(await readErrorMessage(response));
        return;
      }
      await response.json().catch(() => null);
      await onSuccess?.({
        ...account,
        imap: {
          ...account.imap,
          user: imapUser,
          password: ""
        }
      });
      onOpenChange(false);
    } catch {
      setError("Failed to re-login.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="3" style={{ width: "min(460px, 92vw)" }}>
        <Flex direction="column" gap="4">
          <div>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>
              {description ??
                `Credentials for account ${account?.email || account?.name || "this account"} are missing or no longer valid. Please re-enter the IMAP username and password.`}
            </Dialog.Description>
          </div>

          <form onSubmit={handleSubmit}>
            <Flex direction="column" gap="3">
              {account ? (
                <Text size="2" color="gray">
                  Account: {account.name || account.email} {account.name && account.email ? `(${account.email})` : ""}
                </Text>
              ) : null}

              <Field label="IMAP user">
                <TextField.Root
                  value={imapUser}
                  onChange={(event) => setImapUser(event.target.value)}
                  autoComplete="username"
                  required
                />
              </Field>

              <Field label="IMAP password">
                <PasswordField
                  value={imapPassword}
                  onChange={(event) => setImapPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>

              {error ? (
                <Callout.Root color="red" role="alert">
                  <Callout.Text>{error}</Callout.Text>
                </Callout.Root>
              ) : null}

              <Flex justify="end" gap="3">
                <Button
                  type="button"
                  variant="soft"
                  color="gray"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !account}>
                  {submitting ? "Updating credentials..." : "Update credentials"}
                </Button>
              </Flex>
            </Flex>
          </form>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
