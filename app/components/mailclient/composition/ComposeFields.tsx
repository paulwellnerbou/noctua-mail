import { startTransition, useEffect, useState } from "react";
import type React from "react";
import { Button, Text, TextField } from "@radix-ui/themes";
import type { Message, RecipientSuggestion } from "@/lib/data";
import InReplyToReferenceRow from "../InReplyToReferenceRow";
import styles from "./Compose.module.css";

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
  inReplyToMessage?: Message | null;
  onJumpToMessage?: (messageId: string) => void;
  setComposeSubject: React.Dispatch<React.SetStateAction<string>>;
  setComposeTo: React.Dispatch<React.SetStateAction<string>>;
  setComposeCc: React.Dispatch<React.SetStateAction<string>>;
  setComposeBcc: React.Dispatch<React.SetStateAction<string>>;
  setComposeShowBcc: React.Dispatch<React.SetStateAction<boolean>>;
  applyRecipientSelection: (
    current: string,
    selection: RecipientSuggestion,
    setter: React.Dispatch<React.SetStateAction<string>>,
    focusAfter?: RecipientFocus
  ) => string;
  loadRecipientOptions: (query: string, signal: AbortSignal) => Promise<RecipientSuggestion[]>;
  getComposeToken: (value: string) => string;
  markComposeDirty: () => void;
};

type RecipientFieldProps = {
  variant: "inline" | "modal";
  label: string;
  focusKey: Exclude<RecipientFocus, null>;
  value: string;
  placeholder: string;
  recipientOptions: RecipientSuggestion[];
  recipientActiveIndex: number;
  recipientLoading: boolean;
  recipientFocus: RecipientFocus;
  setRecipientQuery: React.Dispatch<React.SetStateAction<string>>;
  setRecipientFocus: React.Dispatch<React.SetStateAction<RecipientFocus>>;
  setRecipientActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  onChangeValue: (next: string) => void;
  onPickRecipient: (current: string, selection: RecipientSuggestion) => void;
  getComposeToken: (value: string) => string;
  showToggle?: boolean;
  toggleLabel?: string;
  toggleTitle?: string;
  toggleDisabled?: boolean;
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
  toggleDisabled,
  onToggle
}: RecipientFieldProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);

  return (
    <div className={styles.composeGridRow}>
      <Text size="2" weight="medium" className={styles.label}>
        {label}
      </Text>
      <div className={styles.composeRow}>
        <div className={styles.composeInputWrap}>
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
            <div className={styles.composeSuggestions}>
              {recipientOptions.map((option, index) => (
                <button
                  key={`${option.kind}-${option.insertValue}-${index}`}
                  type="button"
                  className={`${styles.composeSuggestion} ${
                    index === recipientActiveIndex ? styles.composeSuggestionActive : ""
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setShowSuggestions(false);
                    onPickRecipient(value, option);
                  }}
                >
                  <span>{option.label}</span>
                  {option.kind === "alias" && (
                    <span className={styles.composeSuggestionMuted}>{option.recipients}</span>
                  )}
                </button>
              ))}
              {recipientLoading && (
                <span className={`${styles.composeSuggestion} ${styles.composeSuggestionMuted}`}>
                  Loading…
                </span>
              )}
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
            disabled={toggleDisabled}
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
  inReplyToMessage,
  onJumpToMessage,
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
  const [recipientOptions, setRecipientOptions] = useState<RecipientSuggestion[]>([]);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientFocus, setRecipientFocus] = useState<RecipientFocus>(null);
  const [recipientActiveIndex, setRecipientActiveIndex] = useState(0);

  useEffect(() => {
    setLocalSubject(composeSubject);
  }, [composeSubject]);

  useEffect(() => {
    setLocalTo(composeTo);
  }, [composeTo]);

  useEffect(() => {
    setLocalCc(composeCc);
  }, [composeCc]);

  useEffect(() => {
    setLocalBcc(composeBcc);
  }, [composeBcc]);

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
    selection: RecipientSuggestion,
    setter: React.Dispatch<React.SetStateAction<string>>,
    setLocal: React.Dispatch<React.SetStateAction<string>>,
    focusKey: Exclude<RecipientFocus, null>
  ) => {
    markComposeDirty();
    const next = applyRecipientSelection(current, selection, setter, focusKey);
    setLocal(next);
    setRecipientQuery("");
  };

  const hasCcOrBccValue =
    localCc.trim().length > 0 ||
    localBcc.trim().length > 0 ||
    composeCc.trim().length > 0 ||
    composeBcc.trim().length > 0;
  const showCcBccFields = composeShowBcc || hasCcOrBccValue;
  const canHideCcBcc = !hasCcOrBccValue;
  const toggleLabel = showCcBccFields ? "Hide Cc/Bcc" : "Show Cc and Bcc";
  const toggleTitle = showCcBccFields
    ? canHideCcBcc
      ? "Hide Cc and Bcc"
      : "Clear Cc/Bcc to hide fields"
    : "Show Cc and Bcc";
  const showFrom = variant === "inline";
  const inReplyToRow = inReplyToMessage ? (
    <InReplyToReferenceRow
      variant="compose"
      value={`${inReplyToMessage.subject || "(no subject)"} — ${inReplyToMessage.from}`}
      onClick={onJumpToMessage ? () => onJumpToMessage(inReplyToMessage.id) : undefined}
    />
  ) : null;
  const subjectRow = (
    <div className={styles.composeGridRow}>
      <Text size="2" weight="medium" className={styles.label}>
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
    <div className={styles.composeGridRow}>
      <Text size="2" weight="medium" className={styles.label}>
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
    <div className={styles.composeGrid}>
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
        toggleDisabled={showCcBccFields && !canHideCcBcc}
        onToggle={() => {
          if (!canHideCcBcc) {
            setComposeShowBcc(true);
            return;
          }
          setComposeShowBcc((value) => !value);
        }}
        toggleTitle={toggleTitle}
      />
      {showCcBccFields && (
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
      {showCcBccFields && (
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
      {inReplyToRow}
    </div>
  );
}
