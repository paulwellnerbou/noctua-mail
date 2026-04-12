import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { isDesktop, useIsDesktop } from "@/lib/desktop";
import {
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  Text,
  TextField
} from "@radix-ui/themes";
import AccountSettingsModal from "@/app/components/AccountSettingsModal";
import type { Account } from "@/lib/data";

// Generate deterministic account ID from email address
// This ensures the same email always gets the same account ID across environments
function accountIdFromEmail(email: string): string {
  let hash = 0;
  const str = email.toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return `acc-${Math.abs(hash).toString(36).slice(0, 8)}`;
}

type Props = {
  onAuthenticated: () => void;
};

export default function LoginOverlay({ onAuthenticated }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitLogin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include"
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.message ?? "Login failed";
        setError(msg);
        return;
      }
      await res.json().catch(() => ({}));
      onAuthenticated();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const submitSignup = async (account: Account) => {
    setSubmitting(true);
    setSignupError(null);
    try {
      const authPassword = account.imap.password || account.smtp.password || password;
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode, account, password: authPassword }),
        credentials: "include"
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.message ?? "Signup failed";
        setSignupError(msg);
        return;
      }
      await res.json().catch(() => ({}));
      onAuthenticated();
    } catch {
      setSignupError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitLogin();
  };

  const desktop = useIsDesktop();

  // In desktop mode with no accounts, skip the login screen and go straight to setup.
  // isDesktop() is safe to call inside useEffect (window is always available there).
  useEffect(() => {
    if (!isDesktop()) return;
    fetch("/api/desktop/needs-setup")
      .then((r) => r.json())
      .then((data: { needsSetup?: boolean }) => {
        if (!data?.needsSetup) return;
        setEditingAccount({
          id: accountIdFromEmail(""),
          name: "",
          email: "",
          avatar: "NW",
          imap: { host: "", port: 993, secure: true, user: "", password: "" },
          smtp: { host: "", port: 465, secure: true, user: "", password: "" }
        });
        setSignupOpen(true);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startInviteFlow = () => {
    if (desktop) {
      // In desktop mode, skip the invite code dialog and go directly to account setup.
      if (!editingAccount) {
        setEditingAccount({
          id: accountIdFromEmail(email),
          name: email || "",
          email,
          avatar: "NW",
          imap: { host: "", port: 993, secure: true, user: email, password },
          smtp: { host: "", port: 465, secure: true, user: email, password }
        });
      }
      setSignupOpen(true);
      return;
    }
    setInviteError(null);
    setInviteOpen(true);
  };

  const openSignupModal = () => {
    const code = inviteCode.trim();
    if (!code) {
      setInviteError("Invite code required");
      return;
    }
    if (!editingAccount) {
      setEditingAccount({
        id: accountIdFromEmail(email),
        name: email || "",
        email,
        avatar: "NW",
        imap: { host: "", port: 993, secure: true, user: email, password: "" },
        smtp: { host: "", port: 465, secure: true, user: email, password: "" }
      });
    }
    setInviteOpen(false);
    setSignupOpen(true);
  };


  return (
    <>
      {!signupOpen && !inviteOpen && (
        <Dialog.Root open>
          <Dialog.Content size="3" style={{ width: "min(440px, 92vw)" }}>
            <Flex direction="column" gap="4">
              <div>
                <Dialog.Title>Sign in</Dialog.Title>
                <Dialog.Description>
                  Use your IMAP credentials to access mail.
                </Dialog.Description>
              </div>
              <form onSubmit={submit}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      Email
                    </Text>
                    <TextField.Root
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      IMAP password
                    </Text>
                    <TextField.Root
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </Flex>
                  {error && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{error}</Callout.Text>
                    </Callout.Root>
                  )}
                  <Flex justify="between" align="center" gap="3" wrap="wrap">
                    <Button type="button" variant="ghost" onClick={startInviteFlow}>
                      {desktop ? "Set up new account" : "Got an invite code?"}
                    </Button>
                    <Button type="submit" disabled={submitting}>
                      {submitting ? "Working..." : "Log in"}
                    </Button>
                  </Flex>
                </Flex>
              </form>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      )}

      {inviteOpen && !signupOpen && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open) setInviteOpen(false);
          }}
        >
          <Dialog.Content size="3" style={{ width: "min(420px, 92vw)" }}>
            <Flex direction="column" gap="4">
              <Flex align="start" justify="between" gap="3">
                <div>
                  <Dialog.Title>Invite code</Dialog.Title>
                  <Dialog.Description>
                    Enter your invite code to configure a new account.
                  </Dialog.Description>
                </div>
                <IconButton
                  variant="ghost"
                  aria-label="Close"
                  onClick={() => setInviteOpen(false)}
                >
                  <X size={18} />
                </IconButton>
              </Flex>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  openSignupModal();
                }}
              >
                <Flex direction="column" gap="3">
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      Invite code
                    </Text>
                    <TextField.Root
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      required
                    />
                  </Flex>
                  {inviteError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{inviteError}</Callout.Text>
                    </Callout.Root>
                  )}
                  <Flex justify="between" align="center" gap="3" wrap="wrap">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setInviteOpen(false)}
                    >
                      Back
                    </Button>
                    <Button type="submit">Continue</Button>
                  </Flex>
                </Flex>
              </form>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      )}

      {signupOpen && editingAccount && (
        <>
          {signupError && (
            <div className="auth-error-floating">
              <Callout.Root color="red" role="alert">
                <Callout.Text>{signupError}</Callout.Text>
              </Callout.Root>
            </div>
          )}
          <AccountSettingsModal
            editingAccount={editingAccount}
            isOpen={signupOpen}
            manageTab="account"
            isExistingAccount={false}
            onClose={() => {
              setSignupOpen(false);
              setInviteOpen(false);
            }}
            onTabChange={() => {}}
            onSave={submitSignup}
            onDelete={() => {}}
          />
        </>
      )}
    </>
  );
}
