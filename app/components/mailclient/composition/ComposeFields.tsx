import type React from "react";

type RecipientFocus = "to" | "cc" | "bcc" | null;

type ComposeFieldsProps = {
  variant: "inline" | "modal";
  composeSubject: string;
  composeTo: string;
  composeCc: string;
  composeBcc: string;
  composeShowBcc: boolean;
  composeOpenedAt?: string;
  fromValue?: string;
  recipientOptions: string[];
  recipientActiveIndex: number;
  recipientLoading: boolean;
  recipientFocus: RecipientFocus;
  setComposeSubject: React.Dispatch<React.SetStateAction<string>>;
  setComposeTo: React.Dispatch<React.SetStateAction<string>>;
  setComposeCc: React.Dispatch<React.SetStateAction<string>>;
  setComposeBcc: React.Dispatch<React.SetStateAction<string>>;
  setComposeShowBcc: React.Dispatch<React.SetStateAction<boolean>>;
  setRecipientQuery: React.Dispatch<React.SetStateAction<string>>;
  setRecipientFocus: React.Dispatch<React.SetStateAction<RecipientFocus>>;
  setRecipientActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  applyRecipientSelection: (
    current: string,
    selection: string,
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => void;
  getComposeToken: (value: string) => string;
  markComposeDirty: () => void;
};

type RecipientFieldProps = {
  label: string;
  focusKey: Exclude<RecipientFocus, null>;
  value: string;
  placeholder: string;
  recipientOptions: string[];
  recipientActiveIndex: number;
  recipientLoading: boolean;
  recipientFocus: RecipientFocus;
  setRecipientQuery: React.Dispatch<React.SetStateAction<string>>;
  setRecipientFocus: React.Dispatch<React.SetStateAction<RecipientFocus>>;
  setRecipientActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  applyRecipientSelection: (
    current: string,
    selection: string,
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => void;
  getComposeToken: (value: string) => string;
  setter: React.Dispatch<React.SetStateAction<string>>;
  markComposeDirty: () => void;
  showToggle?: boolean;
  toggleLabel?: string;
  toggleTitle?: string;
  onToggle?: () => void;
};

function RecipientField({
  label,
  focusKey,
  value,
  placeholder,
  recipientOptions,
  recipientActiveIndex,
  recipientLoading,
  recipientFocus,
  setRecipientQuery,
  setRecipientFocus,
  setRecipientActiveIndex,
  applyRecipientSelection,
  getComposeToken,
  setter,
  markComposeDirty,
  showToggle,
  toggleLabel,
  toggleTitle,
  onToggle
}: RecipientFieldProps) {
  return (
    <div className="compose-grid-row">
      <span className="label">{label}</span>
      <div className="compose-row">
        <div className="compose-input-wrap">
          <input
            value={value}
            onChange={(event) => {
              markComposeDirty();
              setter(event.target.value);
              setRecipientQuery(getComposeToken(event.target.value));
            }}
            onFocus={() => {
              setRecipientFocus(focusKey);
              setRecipientQuery(getComposeToken(value));
            }}
            onBlur={() => {
              setTimeout(() => {
                setRecipientFocus((current) => (current === focusKey ? null : current));
              }, 150);
            }}
            onKeyDown={(event) => {
              if (!recipientOptions.length) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setRecipientActiveIndex((prev) =>
                  Math.min(prev + 1, recipientOptions.length - 1)
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setRecipientActiveIndex((prev) => Math.max(prev - 1, 0));
              }
              if (event.key === "Enter" && recipientFocus === focusKey) {
                event.preventDefault();
                const pick = recipientOptions[recipientActiveIndex];
                if (pick) {
                  applyRecipientSelection(value, pick, setter);
                }
              }
            }}
            placeholder={placeholder}
          />
          {recipientFocus === focusKey && recipientOptions.length > 0 && (
            <div className="compose-suggestions">
              {recipientOptions.map((option, index) => (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  className={`compose-suggestion ${
                    index === recipientActiveIndex ? "active" : ""
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyRecipientSelection(value, option, setter);
                  }}
                >
                  {option}
                </button>
              ))}
              {recipientLoading && <span className="compose-suggestion muted">Loading…</span>}
            </div>
          )}
        </div>
        {showToggle && (
          <button
            type="button"
            className="icon-button small"
            title={toggleTitle ?? toggleLabel}
            onClick={onToggle}
          >
            {toggleLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ComposeFields({
  variant,
  composeSubject,
  composeTo,
  composeCc,
  composeBcc,
  composeShowBcc,
  composeOpenedAt,
  fromValue,
  recipientOptions,
  recipientActiveIndex,
  recipientLoading,
  recipientFocus,
  setComposeSubject,
  setComposeTo,
  setComposeCc,
  setComposeBcc,
  setComposeShowBcc,
  setRecipientQuery,
  setRecipientFocus,
  setRecipientActiveIndex,
  applyRecipientSelection,
  getComposeToken,
  markComposeDirty
}: ComposeFieldsProps) {
  const toggleLabel = composeShowBcc ? "Hide Cc/Bcc" : "Show Cc and Bcc";
  const toggleTitle = composeShowBcc ? "Hide Cc and Bcc" : "Show Cc and Bcc";
  const showFrom = variant === "inline";
  const showDate = variant === "modal";
  const subjectRow = (
    <div className="compose-grid-row">
      <span className="label">Subject:</span>
      <input
        value={composeSubject}
        onChange={(event) => {
          markComposeDirty();
          setComposeSubject(event.target.value);
        }}
        placeholder="Subject"
      />
    </div>
  );
  const fromRow = (
    <div className="compose-grid-row">
      <span className="label">From:</span>
      <input value={fromValue ?? ""} readOnly />
    </div>
  );
  const dateRow = (
    <div className="compose-grid-row">
      <span className="label">Date:</span>
      <span className="compose-static">{composeOpenedAt || "Now"}</span>
    </div>
  );

  return (
    <div className="compose-grid">
      {variant === "inline" && subjectRow}
      {showFrom && fromRow}
      <RecipientField
        label="To:"
        focusKey="to"
        value={composeTo}
        placeholder="recipient@example.com"
        recipientOptions={recipientOptions}
        recipientActiveIndex={recipientActiveIndex}
        recipientLoading={recipientLoading}
        recipientFocus={recipientFocus}
        setRecipientQuery={setRecipientQuery}
        setRecipientFocus={setRecipientFocus}
        setRecipientActiveIndex={setRecipientActiveIndex}
        applyRecipientSelection={applyRecipientSelection}
        getComposeToken={getComposeToken}
        setter={setComposeTo}
        markComposeDirty={markComposeDirty}
        showToggle
        toggleLabel={toggleLabel}
        onToggle={() => setComposeShowBcc((value) => !value)}
        toggleTitle={toggleTitle}
      />
      {composeShowBcc && (
        <RecipientField
          label="Cc:"
          focusKey="cc"
          value={composeCc}
          placeholder="cc@example.com"
          recipientOptions={recipientOptions}
          recipientActiveIndex={recipientActiveIndex}
          recipientLoading={recipientLoading}
          recipientFocus={recipientFocus}
          setRecipientQuery={setRecipientQuery}
          setRecipientFocus={setRecipientFocus}
          setRecipientActiveIndex={setRecipientActiveIndex}
          applyRecipientSelection={applyRecipientSelection}
          getComposeToken={getComposeToken}
          setter={setComposeCc}
          markComposeDirty={markComposeDirty}
        />
      )}
      {composeShowBcc && (
        <RecipientField
          label="Bcc:"
          focusKey="bcc"
          value={composeBcc}
          placeholder="bcc@example.com"
          recipientOptions={recipientOptions}
          recipientActiveIndex={recipientActiveIndex}
          recipientLoading={recipientLoading}
          recipientFocus={recipientFocus}
          setRecipientQuery={setRecipientQuery}
          setRecipientFocus={setRecipientFocus}
          setRecipientActiveIndex={setRecipientActiveIndex}
          applyRecipientSelection={applyRecipientSelection}
          getComposeToken={getComposeToken}
          setter={setComposeBcc}
          markComposeDirty={markComposeDirty}
        />
      )}
      {variant === "modal" && subjectRow}
      {showDate && dateRow}
    </div>
  );
}
