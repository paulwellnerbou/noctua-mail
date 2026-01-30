import { useState } from "react";
import { X } from "lucide-react";
import AccountSettingsModal from "@/app/components/AccountSettingsModal";
import type { Account } from "@/lib/data";

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
  const [imapDetecting, setImapDetecting] = useState(false);
  const [smtpDetecting, setSmtpDetecting] = useState(false);
  const [imapProbe, setImapProbe] = useState<{ tls?: boolean; starttls?: boolean } | null>(
    null
  );
  const [smtpProbe, setSmtpProbe] = useState<{ tls?: boolean; starttls?: boolean } | null>(
    null
  );
  const [imapSecurity, setImapSecurity] = useState<"tls" | "starttls" | "none">("tls");
  const [smtpSecurity, setSmtpSecurity] = useState<"tls" | "starttls" | "none">("tls");
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

  const submitSignup = async () => {
    if (!editingAccount) return;
    setSubmitting(true);
    setSignupError(null);
    try {
      const account = editingAccount;
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

  const startInviteFlow = () => {
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
        id: `acc-${crypto.randomUUID().slice(0, 6)}`,
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

  const runProbe = async (protocol: "imap" | "smtp") => {
    if (!editingAccount) return;
    if (protocol === "imap") setImapDetecting(true);
    if (protocol === "smtp") setSmtpDetecting(true);
    const config = protocol === "imap" ? editingAccount.imap : editingAccount.smtp;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch("/api/probe", {
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
          setEditingAccount({
            ...editingAccount,
            imap: { ...editingAccount.imap, secure: true, port: 993 }
          });
        } else if (data.supportsStartTLS) {
          setImapSecurity("starttls");
          setEditingAccount({
            ...editingAccount,
            imap: { ...editingAccount.imap, secure: false, port: 143 }
          });
        } else {
          setImapSecurity("none");
          setEditingAccount({
            ...editingAccount,
            imap: { ...editingAccount.imap, secure: false, port: 143 }
          });
        }
      } else {
        setSmtpProbe({ tls: data.supportsTLS, starttls: data.supportsStartTLS });
        if (data.supportsTLS) {
          setSmtpSecurity("tls");
          setEditingAccount({
            ...editingAccount,
            smtp: { ...editingAccount.smtp, secure: true, port: 465 }
          });
        } else if (data.supportsStartTLS) {
          setSmtpSecurity("starttls");
          setEditingAccount({
            ...editingAccount,
            smtp: { ...editingAccount.smtp, secure: false, port: 587 }
          });
        } else {
          setSmtpSecurity("none");
          setEditingAccount({
            ...editingAccount,
            smtp: { ...editingAccount.smtp, secure: false, port: 25 }
          });
        }
      }
    } finally {
      window.clearTimeout(timer);
      setImapDetecting(false);
      setSmtpDetecting(false);
    }
  };

  return (
    <>
      {!signupOpen && !inviteOpen && (
        <div className="modal-backdrop">
          <div className="modal auth-modal" onClick={(event) => event.stopPropagation()}>
            <div className="auth-header">
              <div>
                <h3>Sign in</h3>
                <p className="settings-subtitle">Use your IMAP credentials to access mail.</p>
              </div>
              <X size={18} className="auth-close" />
            </div>
            <form className="auth-form" onSubmit={submit}>
              <label className="form-field">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="form-field">
                IMAP password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {error && <div className="auth-error">{error}</div>}
              <div className="form-actions">
                <button className="icon-button" type="button" onClick={startInviteFlow}>
                  Got an invite code?
                </button>
                <div style={{ marginLeft: "auto", display: "inline-flex", gap: 10 }}>
                  <button type="submit" className="icon-button" disabled={submitting}>
                    {submitting ? "Working..." : "Log in"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {inviteOpen && !signupOpen && (
        <div className="modal-backdrop">
          <div className="modal auth-modal" onClick={(event) => event.stopPropagation()}>
            <div className="auth-header">
              <div>
                <h3>Invite code</h3>
                <p className="settings-subtitle">
                  Enter your invite code to configure a new account.
                </p>
              </div>
              <X size={18} className="auth-close" onClick={() => setInviteOpen(false)} />
            </div>
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                openSignupModal();
              }}
            >
              <label className="form-field">
                Invite code
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                />
              </label>
              {inviteError && <div className="auth-error">{inviteError}</div>}
              <div className="form-actions">
                <button className="icon-button" type="button" onClick={() => setInviteOpen(false)}>
                  Back
                </button>
                <div style={{ marginLeft: "auto", display: "inline-flex", gap: 10 }}>
                  <button className="icon-button" type="submit">
                    Continue
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {signupOpen && editingAccount && (
        <>
          {signupError && (
            <div className="auth-error auth-error-floating">{signupError}</div>
          )}
          <AccountSettingsModal
            editingAccount={editingAccount}
            isOpen={signupOpen}
            manageTab="account"
            isExistingAccount={false}
            imapDetecting={imapDetecting}
            smtpDetecting={smtpDetecting}
            imapProbe={imapProbe}
            smtpProbe={smtpProbe}
            imapSecurity={imapSecurity}
            smtpSecurity={smtpSecurity}
            onClose={() => {
              setSignupOpen(false);
              setInviteOpen(false);
            }}
            onTabChange={() => {}}
            onSave={submitSignup}
            onDelete={() => {}}
            onUpdateAccount={setEditingAccount}
            onUpdateSettings={() => {}}
            onRunProbe={runProbe}
          />
        </>
      )}
    </>
  );
}
