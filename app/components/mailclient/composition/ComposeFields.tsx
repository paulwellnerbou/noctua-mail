import { startTransition, useEffect, useState } from "react";
import type React from "react";
import { Button, Text, TextField } from "@radix-ui/themes";

type RecipientFocus = "to" | "cc" | "bcc" | null;

type ComposeFieldsProps = {
  variant: "inline" | "modal";
  composeSubject: string;
  composeTo: string;
  composeCc: string;
  composeBcc: string;
  composeShowBcc: boolean;
  composeOpenedAt?: string;
  activeAccountId: string | null;
  fromValue?: string;
  setComposeSubject: React.Dispatch<React.SetStateAction<string>>;
  setComposeTo: React.Dispatch<React.SetStateAction<string>>;
  setComposeCc: React.Dispatch<React.SetStateAction<string>>;
  setComposeBcc: React.Dispatch<React.SetStateAction<string>>;
  setComposeShowBcc: React.Dispatch<React.SetStateAction<boolean>>;
  applyRecipientSelection: (
    current: string,
    selection: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    focusAfter?: RecipientFocus
  ) => string;
  loadRecipientOptions: (query: string, signal: AbortSignal) => Promise<string[]>;
  getComposeToken: (value: string) => string;
  markComposeDirty: () => void;
};

type RecipientFieldProps = {
  variant: "inline" | "modal";
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
  onChangeValue: (next: string) => void;
  onPickRecipient: (current: string, selection: string) => void;
  getComposeToken: (value: string) => string;
  showToggle?: boolean;
  toggleLabel?: string;
  toggleTitle?: string;
  onToggle?: () => void;
};

function RecipientField({
  variant,
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
  onChangeValue,
  onPickRecipient,
  getComposeToken,
  showToggle,
  toggleLabel,
  toggleTitle,
  onToggle
}: RecipientFieldProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);

  return (
    <div className="compose-grid-row">
      <Text size="2" weight="medium" className="label">
        {label}
      </Text>
      <div className="compose-row">
        <div className="compose-input-wrap">
          <TextField.Root
            id={`compose-${variant}-${focusKey}`}
            name={`compose_${focusKey}`}
            size="2"
            value={value}
            onChange={(event) => {
              onChangeValue(event.target.value);
              setRecipientQuery(getComposeToken(event.target.value));
              setShowSuggestions(true);
            }}
            onFocus={() => {
              setRecipientFocus(focusKey);
              setRecipientQuery(getComposeToken(value));
              setShowSuggestions(false);
            }}
            onBlur={() => {
              setShowSuggestions(false);
              setTimeout(() => {
                setRecipientFocus((current) => (current === focusKey ? null : current));
              }, 150);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (!showSuggestions) {
                  setShowSuggestions(true);
                  return;
                }
                if (!recipientOptions.length) return;
                setRecipientActiveIndex((prev) => Math.min(prev + 1, recipientOptions.length - 1));
              }
              if (event.key === "ArrowUp") {
                if (!recipientOptions.length) return;
                event.preventDefault();
                setRecipientActiveIndex((prev) => Math.max(prev - 1, 0));
              }
              if (event.key === "Enter" && recipientFocus === focusKey) {
                if (!recipientOptions.length) return;
                event.preventDefault();
                const pick = recipientOptions[recipientActiveIndex];
                if (pick) {
                  setShowSuggestions(false);
                  onPickRecipient(value, pick);
                }
              }
            }}
            placeholder={placeholder}
          />
          {recipientFocus === focusKey && showSuggestions && recipientOptions.length > 0 && (
            <div className="compose-suggestions">
              {recipientOptions.map((option, index) => (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  className={`compose-suggestion ${index === recipientActiveIndex ? "active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setShowSuggestions(false);
                    onPickRecipient(value, option);
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
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            title={toggleTitle ?? toggleLabel}
            onClick={onToggle}
          >
            {toggleLabel}
          </Button>
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
  activeAccountId,
  fromValue,
  setComposeSubject,
  setComposeTo,
  setComposeCc,
  setComposeBcc,
  setComposeShowBcc,
  applyRecipientSelection,
  loadRecipientOptions,
  getComposeToken,
  markComposeDirty
}: ComposeFieldsProps) {
  const [localSubject, setLocalSubject] = useState(composeSubject);
  const [localTo, setLocalTo] = useState(composeTo);
  const [localCc, setLocalCc] = useState(composeCc);
  const [localBcc, setLocalBcc] = useState(composeBcc);
  const [recipientOptions, setRecipientOptions] = useState<string[]>([]);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientFocus, setRecipientFocus] = useState<RecipientFocus>(null);
  const [recipientActiveIndex, setRecipientActiveIndex] = useState(0);

  useEffect(() => {
    if (!activeAccountId) {
      setRecipientOptions([]);
      setRecipientLoading(false);
      setRecipientActiveIndex(0);
      return;
    }
    if (!recipientFocus) {
      setRecipientLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setRecipientLoading(true);
        const list = await loadRecipientOptions(recipientQuery.trim(), controller.signal);
        if (!active) return;
        setRecipientOptions(list);
        setRecipientActiveIndex(0);
      } catch {
        if (!active || controller.signal.aborted) return;
        setRecipientOptions([]);
      } finally {
        if (active) setRecipientLoading(false);
      }
    }, 180);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeAccountId, recipientFocus, recipientQuery, loadRecipientOptions]);

  const commitSubject = (next: string) => {
    markComposeDirty();
    setLocalSubject(next);
    startTransition(() => setComposeSubject(next));
  };

  const commitRecipient = (
    next: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    setLocal: React.Dispatch<React.SetStateAction<string>>
  ) => {
    markComposeDirty();
    setLocal(next);
    startTransition(() => setter(next));
  };

  const pickRecipient = (
    current: string,
    selection: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    setLocal: React.Dispatch<React.SetStateAction<string>>,
    focusKey: Exclude<RecipientFocus, null>
  ) => {
    markComposeDirty();
    const next = applyRecipientSelection(current, selection, setter, focusKey);
    setLocal(next);
    setRecipientQuery("");
  };

  const toggleLabel = composeShowBcc ? "Hide Cc/Bcc" : "Show Cc and Bcc";
  const toggleTitle = composeShowBcc ? "Hide Cc and Bcc" : "Show Cc and Bcc";
  const showFrom = variant === "inline";
  const subjectRow = (
    <div className="compose-grid-row">
      <Text size="2" weight="medium" className="label">
        Subject:
      </Text>
      <TextField.Root
        id={`compose-${variant}-subject`}
        name="compose_subject"
        size="2"
        value={localSubject}
        onChange={(event) => {
          commitSubject(event.target.value);
        }}
        placeholder="Subject"
      />
    </div>
  );
  const fromRow = (
    <div className="compose-grid-row">
      <Text size="2" weight="medium" className="label">
        From:
      </Text>
      <TextField.Root
        id={`compose-${variant}-from`}
        name="compose_from"
        size="2"
        value={fromValue ?? ""}
        readOnly
      />
    </div>
  );

  return (
    <div className="compose-grid">
      {showFrom && fromRow}
      <RecipientField
        variant={variant}
        label="To:"
        focusKey="to"
        value={localTo}
        placeholder="recipient@example.com"
        recipientOptions={recipientOptions}
        recipientActiveIndex={recipientActiveIndex}
        recipientLoading={recipientLoading}
        recipientFocus={recipientFocus}
        setRecipientQuery={setRecipientQuery}
        setRecipientFocus={setRecipientFocus}
        setRecipientActiveIndex={setRecipientActiveIndex}
        onChangeValue={(next) => commitRecipient(next, setComposeTo, setLocalTo)}
        onPickRecipient={(current, selection) =>
          pickRecipient(current, selection, setComposeTo, setLocalTo, "to")
        }
        getComposeToken={getComposeToken}
        showToggle
        toggleLabel={toggleLabel}
        onToggle={() => setComposeShowBcc((value) => !value)}
        toggleTitle={toggleTitle}
      />
      {composeShowBcc && (
        <RecipientField
          variant={variant}
          label="Cc:"
          focusKey="cc"
          value={localCc}
          placeholder="cc@example.com"
          recipientOptions={recipientOptions}
          recipientActiveIndex={recipientActiveIndex}
          recipientLoading={recipientLoading}
          recipientFocus={recipientFocus}
          setRecipientQuery={setRecipientQuery}
          setRecipientFocus={setRecipientFocus}
          setRecipientActiveIndex={setRecipientActiveIndex}
          onChangeValue={(next) => commitRecipient(next, setComposeCc, setLocalCc)}
          onPickRecipient={(current, selection) =>
            pickRecipient(current, selection, setComposeCc, setLocalCc, "cc")
          }
          getComposeToken={getComposeToken}
        />
      )}
      {composeShowBcc && (
        <RecipientField
          variant={variant}
          label="Bcc:"
          focusKey="bcc"
          value={localBcc}
          placeholder="bcc@example.com"
          recipientOptions={recipientOptions}
          recipientActiveIndex={recipientActiveIndex}
          recipientLoading={recipientLoading}
          recipientFocus={recipientFocus}
          setRecipientQuery={setRecipientQuery}
          setRecipientFocus={setRecipientFocus}
          setRecipientActiveIndex={setRecipientActiveIndex}
          onChangeValue={(next) => commitRecipient(next, setComposeBcc, setLocalBcc)}
          onPickRecipient={(current, selection) =>
            pickRecipient(current, selection, setComposeBcc, setLocalBcc, "bcc")
          }
          getComposeToken={getComposeToken}
        />
      )}
      {subjectRow}
    </div>
  );
}
