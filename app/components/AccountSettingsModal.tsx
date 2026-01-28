import type { Account, AccountSettings } from "@/lib/data";

type ManageTab = "account" | "signatures" | "preferences";

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
  onClose: () => void;
  onTabChange: (tab: ManageTab) => void;
  onSave: () => void;
  onDelete: () => void;
  onUpdateAccount: (next: Account) => void;
  onUpdateSettings: (next: AccountSettings) => void;
  onRunProbe: (protocol: "imap" | "smtp") => void;
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
  onClose,
  onTabChange,
  onSave,
  onDelete,
  onUpdateAccount,
  onUpdateSettings,
  onRunProbe
}: Props) {
  if (!isOpen) return null;
  const signatures = editingAccount.settings?.signatures ?? [];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal account-settings-modal" onClick={(event) => event.stopPropagation()}>
        <h3>Account settings</h3>
        <div className="settings-tabs">
          <div className="button-group">
            <button
              className={`icon-button small ${manageTab === "account" ? "active" : ""}`}
              onClick={() => onTabChange("account")}
            >
              Account
            </button>
            <button
              className={`icon-button small ${manageTab === "signatures" ? "active" : ""}`}
              onClick={() => onTabChange("signatures")}
              disabled={!isExistingAccount}
              title={
                isExistingAccount
                  ? "Signatures"
                  : "Save the account before editing signatures"
              }
            >
              Signatures
            </button>
            <button
              className={`icon-button small ${manageTab === "preferences" ? "active" : ""}`}
              onClick={() => onTabChange("preferences")}
              disabled={!isExistingAccount}
              title={
                isExistingAccount
                  ? "Preferences"
                  : "Save the account before editing preferences"
              }
            >
              Preferences
            </button>
          </div>
        </div>
        <div className="settings-body">
          <div className={`settings-tab ${manageTab === "account" ? "active" : ""}`}>
            <div className="tab-content">
              <p className="settings-subtitle">
                Manage IMAP/SMTP credentials for syncing and sending.
              </p>
              <div className="form-section">
                <h4>Account details</h4>
                <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
                  <label className="form-field">
                    Name
                    <input
                      value={editingAccount.name}
                      onChange={(event) =>
                        onUpdateAccount({ ...editingAccount, name: event.target.value })
                      }
                    />
                  </label>
                  <label className="form-field">
                    Email
                    <input
                      value={editingAccount.email}
                      onChange={(event) =>
                        onUpdateAccount({ ...editingAccount, email: event.target.value })
                      }
                    />
                  </label>
                </form>
              </div>

              <div className="form-section">
                <div className="section-header">
                  <h4>IMAP (Incoming Server)</h4>
                  <button
                    className="icon-button"
                    onClick={() => onRunProbe("imap")}
                    disabled={imapDetecting}
                  >
                    {imapDetecting ? "Detecting..." : "Detect security"}
                  </button>
                </div>
                {imapProbe && (
                  <p className="section-note">
                    TLS: {imapProbe.tls ? "Yes" : "No"} · STARTTLS:{" "}
                    {imapProbe.starttls ? "Yes" : "No"}
                  </p>
                )}
                <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
                  <label className="form-field">
                    Security
                    <select
                      value={imapSecurity}
                      onChange={(event) => {
                        const next = event.target.value as "tls" | "starttls" | "none";
                        const port = next === "tls" ? 993 : 143;
                        onUpdateAccount({
                          ...editingAccount,
                          imap: { ...editingAccount.imap, secure: next === "tls", port }
                        });
                      }}
                    >
                      {(imapProbe?.tls ?? true) && <option value="tls">TLS (implicit)</option>}
                      {(imapProbe?.starttls ?? true) && (
                        <option value="starttls">STARTTLS</option>
                      )}
                      <option value="none">None</option>
                    </select>
                  </label>
                  <label className="form-field">
                    IMAP host
                    <input
                      value={editingAccount.imap.host}
                      onChange={(event) =>
                        onUpdateAccount({
                          ...editingAccount,
                          imap: { ...editingAccount.imap, host: event.target.value }
                        })
                      }
                    />
                  </label>
                  <label className="form-field">
                    IMAP port
                    <input
                      type="number"
                      value={editingAccount.imap.port}
                      onChange={(event) =>
                        onUpdateAccount({
                          ...editingAccount,
                          imap: { ...editingAccount.imap, port: Number(event.target.value) }
                        })
                      }
                    />
                  </label>
                  <label className="form-field">
                    IMAP user
                    <input
                      value={editingAccount.imap.user}
                      onChange={(event) =>
                        onUpdateAccount({
                          ...editingAccount,
                          imap: { ...editingAccount.imap, user: event.target.value }
                        })
                      }
                    />
                  </label>
                  <label className="form-field">
                    IMAP password
                    <input
                      type="password"
                      value={editingAccount.imap.password}
                      onChange={(event) =>
                        onUpdateAccount({
                          ...editingAccount,
                          imap: { ...editingAccount.imap, password: event.target.value }
                        })
                      }
                    />
                  </label>
                </form>
              </div>

              <div className="form-section">
                <div className="section-header">
                  <h4>SMTP (Outgoing Server)</h4>
                  <button
                    className="icon-button"
                    onClick={() => onRunProbe("smtp")}
                    disabled={smtpDetecting}
                  >
                    {smtpDetecting ? "Detecting..." : "Detect security"}
                  </button>
                </div>
                <p className="section-note">
                  Detection reads server capabilities only — it does not require authentication.
                </p>
                {smtpProbe && (
                  <p className="section-note">
                    TLS: {smtpProbe.tls ? "Yes" : "No"} · STARTTLS:{" "}
                    {smtpProbe.starttls ? "Yes" : "No"}
                  </p>
                )}
                <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
                  <label className="form-field">
                    Security
                    <select
                      value={smtpSecurity}
                      onChange={(event) => {
                        const next = event.target.value as "tls" | "starttls" | "none";
                        const port = next === "tls" ? 465 : next === "starttls" ? 587 : 25;
                        onUpdateAccount({
                          ...editingAccount,
                          smtp: { ...editingAccount.smtp, secure: next === "tls", port }
                        });
                      }}
                    >
                      {(smtpProbe?.tls ?? true) && <option value="tls">TLS (implicit)</option>}
                      {(smtpProbe?.starttls ?? true) && (
                        <option value="starttls">STARTTLS</option>
                      )}
                      <option value="none">None</option>
                    </select>
                  </label>
                  <label className="form-field">
                    SMTP host
                    <input
                      value={editingAccount.smtp.host}
                      onChange={(event) =>
                        onUpdateAccount({
                          ...editingAccount,
                          smtp: { ...editingAccount.smtp, host: event.target.value }
                        })
                      }
                    />
                  </label>
                  <label className="form-field">
                    SMTP port
                    <input
                      type="number"
                      value={editingAccount.smtp.port}
                      onChange={(event) =>
                        onUpdateAccount({
                          ...editingAccount,
                          smtp: { ...editingAccount.smtp, port: Number(event.target.value) }
                        })
                      }
                    />
                  </label>
                  <label className="form-field">
                    SMTP user
                    <input
                      value={editingAccount.smtp.user}
                      onChange={(event) =>
                        onUpdateAccount({
                          ...editingAccount,
                          smtp: { ...editingAccount.smtp, user: event.target.value }
                        })
                      }
                    />
                  </label>
                  <label className="form-field">
                    SMTP password
                    <input
                      type="password"
                      value={editingAccount.smtp.password}
                      onChange={(event) =>
                        onUpdateAccount({
                          ...editingAccount,
                          smtp: { ...editingAccount.smtp, password: event.target.value }
                        })
                      }
                    />
                  </label>
                </form>
              </div>
            </div>
            <div className="form-divider" />
            <div className="form-actions">
              <button className="icon-button" onClick={onDelete} disabled={!isExistingAccount}>
                Delete Account
              </button>
              <div style={{ marginLeft: "auto", display: "inline-flex", gap: 10 }}>
                <button className="icon-button" onClick={onClose}>
                  Cancel
                </button>
                <button className="icon-button" onClick={onSave}>
                  Save
                </button>
              </div>
            </div>
          </div>

          <div className={`settings-tab ${manageTab === "signatures" ? "active" : ""}`}>
            <div className="tab-content">
              <p className="settings-subtitle">Manage signatures for this account.</p>
              <div className="form-section">
                <h4>Signature list</h4>
                <form onSubmit={(event) => event.preventDefault()}>
                  <div className="section-header" style={{ justifyContent: "flex-end" }}>
                    <button
                      className="icon-button"
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
                    </button>
                  </div>
                  <div className="form-grid">
                    <label className="form-field">
                      Default signature
                      <select
                        value={editingAccount.settings?.defaultSignatureId ?? ""}
                        onChange={(event) =>
                          onUpdateSettings({ defaultSignatureId: event.target.value })
                        }
                      >
                        <option value="">None</option>
                        {signatures.map((signature) => (
                          <option key={signature.id} value={signature.id}>
                            {signature.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {signatures.length === 0 ? (
                    <p className="section-note">No signatures yet.</p>
                  ) : (
                    <div className="signature-list">
                      {signatures.map((signature) => (
                        <div key={signature.id} className="signature-item">
                          <label className="form-field">
                            Name
                            <input
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
                          </label>
                          <label className="form-field">
                            Signature text
                            <textarea
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
                          </label>
                          <div className="signature-actions">
                            <button
                              className="icon-button small"
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
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </form>
              </div>
            </div>
            <div className="form-divider" />
            <div className="form-actions">
              <button className="icon-button" onClick={onClose}>
                Cancel
              </button>
              <button className="icon-button" onClick={onSave} disabled={!isExistingAccount}>
                Save
              </button>
            </div>
          </div>

          <div className={`settings-tab ${manageTab === "preferences" ? "active" : ""}`}>
            <div className="tab-content">
              <p className="settings-subtitle">Control behavior, layout, and sync performance.</p>
              <div className="form-section">
                <div className="form-section">
                  <h4>Behavior</h4>
                  <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
                    <label className="form-field">
                      Include threads across folders
                      <select
                        value={
                          (editingAccount.settings?.threading?.includeAcrossFolders ?? true)
                            ? "yes"
                            : "no"
                        }
                        onChange={(event) =>
                          onUpdateSettings({
                            threading: {
                              ...(editingAccount.settings?.threading ?? {}),
                              includeAcrossFolders: event.target.value === "yes"
                            }
                          })
                        }
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </label>
                  </form>
                </div>
                <div className="form-section">
                  <h4>Layout</h4>
                  <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
                    <label className="form-field">
                      Default layout
                      <select
                        value={editingAccount.settings?.layout?.defaultView ?? "card"}
                        onChange={(event) =>
                          onUpdateSettings({
                            layout: {
                              ...(editingAccount.settings?.layout ?? {}),
                              defaultView: event.target.value as "card" | "table"
                            }
                          })
                        }
                      >
                        <option value="card">Card view</option>
                        <option value="table">Table view</option>
                      </select>
                    </label>
                  </form>
                </div>
                <div className="form-section">
                  <h4>Performance</h4>
                  <p className="section-note">
                    Controls IMAP polling and how many folders stay on IDLE.
                  </p>
                  <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
                    <label className="form-field">
                      Max idle sessions
                      <input
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
                      <span className="section-note">
                        Number of folders kept on IMAP IDLE simultaneously.
                      </span>
                    </label>
                    <label className="form-field">
                      Poll interval (ms)
                      <input
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
                      <span className="section-note">
                        Frequency for background folder status checks.
                      </span>
                    </label>
                  </form>
                </div>
              </div>
            </div>
            <div className="form-divider" />
            <div className="form-actions">
              <button className="icon-button" onClick={onClose}>
                Cancel
              </button>
              <button className="icon-button" onClick={onSave} disabled={!isExistingAccount}>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
