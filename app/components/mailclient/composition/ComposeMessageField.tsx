"use client";

import type React from "react";
import { useMemo, useRef, useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretRightIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import { Button, DropdownMenu, Tabs } from "@radix-ui/themes";
import { Paperclip } from "lucide-react";
import dynamic from "next/dynamic";
import type { ComposeEditorHandle } from "../../ComposeEditor";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import type { Attachment } from "@/lib/data";
import { assembleQuotedHtml } from "@/lib/html";
import {
  computeBodyOnSwitchToText,
  computeHtmlOnSwitchToHtml,
  computeMarkdownOnSwitchToMarkdown
} from "./composeTabSwitch";
import AttachmentsList from "../../AttachmentsList";
import ComposeMarkdownEditor from "../../ComposeMarkdownEditor";
import ComposePlainTextEditor from "../../ComposePlainTextEditor";
import HtmlMessage from "../../HtmlMessage";
import threadStyles from "../message/ThreadMessageCard.module.css";
import composeStyles from "./Compose.module.css";
import styles from "./ComposeMessageField.module.css";
import ComposeInviteSection from "./ComposeInviteSection";

// @lexical/* (~5 MB of packages) only mounts when the user switches to the
// HTML compose tab — keep it out of the initial MailClient chunk.
const ComposeEditor = dynamic(() => import("../../ComposeEditor"), {
  ssr: false
});

type ComposeTab = "text" | "html" | "markdown";
type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type Signature = {
  id: string;
  name: string;
  body: string;
};

type QuotedParts = {
  styles: string;
  headerHtml: string;
  bodyHtml: string;
};

type ComposeMessageFieldProps = {
  darkMode: boolean;
  composeMode: ComposeMode;
  composeTab: ComposeTab;
  composeBody: string;
  composeHtml: string;
  composeHtmlText: string;
  composeMarkdown: string;
  composeInvite: ComposeInviteDraft | null;
  composeIncludeOriginal: boolean;
  composeQuoteHtml: boolean;
  composeQuotedHtml: string;
  composeQuotedText: string;
  composeQuotedParts: QuotedParts | null;
  composeStripImages: boolean;
  composeEditorReset: number;
  visibleComposeAttachments: Attachment[];
  composeSignatureId: string;
  signatureMenuOpen: boolean;
  selectedSignature: Signature | null;
  accountSignatures: Signature[];
  composeTextRef: React.RefObject<HTMLTextAreaElement | null>;
  composeBodyDebounceRef: React.MutableRefObject<NodeJS.Timeout | null>;
  composeBodyLastUpdateRef: React.MutableRefObject<number>;
  composeMarkdownRef: React.MutableRefObject<string>;
  composeDirtyRef: React.MutableRefObject<boolean>;
  composeEditorInitRef: React.MutableRefObject<boolean>;
  composeLastEditedRef: React.MutableRefObject<ComposeTab>;
  stripHtml: (value: string) => string;
  setComposeBody: React.Dispatch<React.SetStateAction<string>>;
  setComposeHtml: React.Dispatch<React.SetStateAction<string>>;
  setComposeHtmlText: React.Dispatch<React.SetStateAction<string>>;
  setComposeMarkdown: React.Dispatch<React.SetStateAction<string>>;
  setComposeInviteEnabled: (enabled: boolean) => void;
  setComposeInviteLocation: (value: string) => void;
  setComposeInviteStart: (value: string) => void;
  setComposeInviteEnd: (value: string) => void;
  setComposeInviteAllDay: (value: boolean) => void;
  setComposeInviteRecurrenceRule: (value: string) => void;
  setComposeTab: React.Dispatch<React.SetStateAction<ComposeTab>>;
  setComposeEditorReset: React.Dispatch<React.SetStateAction<number>>;
  setComposeIncludeOriginal: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeQuoteHtml: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeQuotedHtml: React.Dispatch<React.SetStateAction<string>>;
  setComposeQuotedText: React.Dispatch<React.SetStateAction<string>>;
  setComposeQuotedHtmlEdited: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeQuotedParts: React.Dispatch<React.SetStateAction<QuotedParts | null>>;
  setComposeStripImages: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeSignatureId: React.Dispatch<React.SetStateAction<string>>;
  setSignatureMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  applySignatureToCompose: (signature: { id: string; body: string } | null) => void;
  handleInlineImage: (file: File, dataUrl: string) => Promise<void>;
  handleComposeAttachmentPick: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  removeComposeAttachment: (attachmentId: string) => void;
};

export default function ComposeMessageField({
  darkMode,
  composeMode,
  composeTab,
  composeBody,
  composeHtml,
  composeHtmlText,
  composeMarkdown,
  composeInvite,
  composeIncludeOriginal,
  composeQuoteHtml,
  composeQuotedHtml,
  composeQuotedText,
  composeQuotedParts,
  composeStripImages,
  composeEditorReset,
  visibleComposeAttachments,
  composeSignatureId,
  signatureMenuOpen,
  selectedSignature,
  accountSignatures,
  composeTextRef,
  composeBodyDebounceRef,
  composeBodyLastUpdateRef,
  composeMarkdownRef,
  composeDirtyRef,
  composeEditorInitRef,
  composeLastEditedRef,
  stripHtml,
  setComposeBody,
  setComposeHtml,
  setComposeHtmlText,
  setComposeMarkdown,
  setComposeInviteEnabled,
  setComposeInviteLocation,
  setComposeInviteStart,
  setComposeInviteEnd,
  setComposeInviteAllDay,
  setComposeInviteRecurrenceRule,
  setComposeTab,
  setComposeEditorReset,
  setComposeIncludeOriginal,
  setComposeQuoteHtml,
  setComposeQuotedHtml,
  setComposeQuotedText,
  setComposeQuotedHtmlEdited,
  setComposeQuotedParts,
  setComposeStripImages,
  setComposeSignatureId,
  setSignatureMenuOpen,
  applySignatureToCompose,
  handleInlineImage,
  handleComposeAttachmentPick,
  removeComposeAttachment
}: ComposeMessageFieldProps) {
  const hasQuotedHtml = composeQuotedHtml.trim().length > 0;
  const hasQuotedParts = Boolean(composeQuotedParts);
  const hasQuotedContent = hasQuotedHtml || hasQuotedParts;
  const [isQuotedExpanded, setIsQuotedExpanded] = useState(true);
  const composeEditorRef = useRef<ComposeEditorHandle | null>(null);
  // Local to each rendered instance: the inline and modal composers mount the
  // same element in different trees, so a shared ref would be nulled when the
  // other instance unmounts during a view switch, breaking the Attach button.
  const composeAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  // Preview mirrors the payload: assembled from parts using the current
  // composeQuoteHtml flag, falling back to composeQuotedHtml for restored
  // drafts where parts aren't available.
  const previewQuotedHtml = useMemo(() => {
    if (composeQuotedParts) {
      return assembleQuotedHtml(composeQuotedParts, composeQuoteHtml);
    }
    return composeQuotedHtml;
  }, [composeQuotedParts, composeQuotedHtml, composeQuoteHtml]);
  const switchComposeTab = (nextTab: ComposeTab) => {
    if (nextTab === composeTab) return;
    const lastEdited = composeLastEditedRef.current;
    const currentMarkdown = composeMarkdownRef.current;

    if (nextTab === "html") {
      composeEditorInitRef.current = false;
      const currentBody = composeTextRef.current?.value || composeBody;
      const result = computeHtmlOnSwitchToHtml(
        { lastEdited, composeBody: currentBody, composeMarkdown: currentMarkdown },
        { stripHtml }
      );
      if (result) {
        setComposeHtml(result.html);
        setComposeHtmlText(result.htmlText);
        // Force the Lexical editor to seed from the converted HTML instead of
        // preserving its previous internal state.
        setComposeEditorReset((prev) => prev + 1);
        if (lastEdited === "text") setComposeBody(currentBody);
      }
      setComposeTab("html");
      return;
    }

    if (nextTab === "text") {
      const currentBody = composeTextRef.current?.value || composeBody;
      const nextText = computeBodyOnSwitchToText(
        {
          lastEdited,
          composeHtml,
          composeHtmlText,
          composeMarkdown: currentMarkdown,
          composeQuotedParts,
          composeQuotedHtml,
          composeIncludeOriginal
        },
        { stripHtml }
      );
      if (nextText.trim().length > 0 || currentBody.trim().length === 0) {
        setComposeBody(nextText);
      }
      setComposeTab("text");
      return;
    }

    if (nextTab === "markdown") {
      const currentBody = composeTextRef.current?.value || composeBody;
      const nextMd = computeMarkdownOnSwitchToMarkdown({
        lastEdited,
        composeBody: currentBody,
        composeHtml
      });
      if (nextMd !== null) setComposeMarkdown(nextMd);
      setComposeTab("markdown");
    }
  };

  const toggleIncludeOriginal = () => {
    setComposeIncludeOriginal((prev) => {
      const next = !prev;
      if (!next) setIsQuotedExpanded(false);
      return next;
    });
  };

  const handleStripImages = () => {
    if (composeStripImages) return;
    const strip = (value: string) => value.replace(/<img[\s\S]*?>/gi, "");
    setComposeStripImages(true);
    setComposeHtml((prev) => (prev ? strip(prev) : prev));
    if (composeQuotedParts) {
      setComposeQuotedParts({ ...composeQuotedParts, bodyHtml: strip(composeQuotedParts.bodyHtml) });
    }
  };

  const toggleQuoteHtml = () => {
    setComposeQuoteHtml((prev) => !prev);
  };

  const handleEditQuotedHtml = () => {
    if (!composeEditorRef.current) return;
    const sourceHtml = composeQuotedParts
      ? assembleQuotedHtml(composeQuotedParts, composeQuoteHtml)
      : composeQuotedHtml.trim();
    if (!sourceHtml) return;
    const quotedBlock =
      composeQuoteHtml && !/<blockquote\b/i.test(sourceHtml)
        ? `<blockquote class="compose-quote">${sourceHtml}</blockquote>`
        : sourceHtml;
    composeEditorRef.current.appendHtmlBlock(quotedBlock);
    setComposeQuotedHtmlEdited(true);
    setComposeIncludeOriginal(false);
    setComposeQuoteHtml(false);
    setComposeQuotedHtml("");
    setComposeQuotedText("");
    setComposeQuotedParts(null);
    composeDirtyRef.current = true;
    composeLastEditedRef.current = "html";
  };

  const handleRemoveQuoted = () => {
    setComposeIncludeOriginal(false);
    composeDirtyRef.current = true;
  };

  const handleToggleQuotedHtml = () => {
    setComposeQuoteHtml((prev) => !prev);
    composeDirtyRef.current = true;
  };

  return (
    <div className={composeStyles.composeMessageField}>
      <ComposeInviteSection
        inviteDraft={composeInvite}
        onEnableChange={setComposeInviteEnabled}
        onLocationChange={setComposeInviteLocation}
        onStartChange={setComposeInviteStart}
        onEndChange={setComposeInviteEnd}
        onAllDayChange={setComposeInviteAllDay}
        onRecurrenceRuleChange={setComposeInviteRecurrenceRule}
      />
      <div className={composeStyles.composeTabsRow}>
        <div className={composeStyles.composeTabs}>
          <Tabs.Root value={composeTab} onValueChange={(value) => switchComposeTab(value as ComposeTab)}>
            <Tabs.List size="1" className={threadStyles.tabsList}>
              <Tabs.Trigger value="html" className={threadStyles.tabTrigger} tabIndex={-1}>
                HTML
              </Tabs.Trigger>
              <Tabs.Trigger value="markdown" className={threadStyles.tabTrigger} tabIndex={-1}>
                Markdown
              </Tabs.Trigger>
              <Tabs.Trigger value="text" className={threadStyles.tabTrigger} tabIndex={-1}>
                Text
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </div>
        <div className={composeStyles.composeAttach}>
          <DropdownMenu.Root open={signatureMenuOpen} onOpenChange={setSignatureMenuOpen}>
            <DropdownMenu.Trigger>
              <Button
                type="button"
                size="1"
                variant="soft"
                color="gray"
                title="Choose signature"
                tabIndex={-1}
              >
                {selectedSignature ? selectedSignature.name : "Signature"}
                <ChevronDownIcon width={14} height={14} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" className={composeStyles.composeSignatureMenu}>
              <DropdownMenu.RadioGroup
                value={composeSignatureId || "__none"}
                onValueChange={(value) => {
                  if (value === "__none") {
                    setComposeSignatureId("");
                    applySignatureToCompose(null);
                    setSignatureMenuOpen(false);
                    return;
                  }
                  const signature = accountSignatures.find((entry) => entry.id === value);
                  if (!signature) return;
                  setComposeSignatureId(signature.id);
                  applySignatureToCompose(signature);
                  setSignatureMenuOpen(false);
                }}
              >
                <DropdownMenu.RadioItem value="__none">No signature</DropdownMenu.RadioItem>
                {accountSignatures.map((signature) => (
                  <DropdownMenu.RadioItem key={signature.id} value={signature.id}>
                    {signature.name}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            title="Add attachment"
            onClick={() => composeAttachmentInputRef.current?.click()}
            tabIndex={-1}
          >
            <Paperclip size={12} />
            Attach
          </Button>
          <input
            ref={composeAttachmentInputRef}
            type="file"
            multiple
            id="compose-attachment-input"
            name="compose_attachments"
            style={{ display: "none" }}
            onChange={handleComposeAttachmentPick}
          />
        </div>
      </div>
      {composeTab === "text" && (
        <>
          <div className={`${styles.composeWriting} ${styles.composeWritingText}`}>
            <ComposePlainTextEditor
              resetKey={`text-body-${composeEditorReset}`}
              id="compose-text-body"
              name="compose_body"
              textareaRef={composeTextRef}
              defaultValue={composeBody}
              onChange={(event) => {
                composeDirtyRef.current = true;
                composeLastEditedRef.current = "text";

                const now = Date.now();
                const timeSinceLastUpdate = now - composeBodyLastUpdateRef.current;
                const nextValue = event.target.value;

                const updateState = () => {
                  setComposeBody(nextValue);
                  composeBodyLastUpdateRef.current = now;
                };

                if (timeSinceLastUpdate >= 10000) {
                  if (composeBodyDebounceRef.current) {
                    clearTimeout(composeBodyDebounceRef.current);
                    composeBodyDebounceRef.current = null;
                  }
                  updateState();
                } else {
                  if (composeBodyDebounceRef.current) {
                    clearTimeout(composeBodyDebounceRef.current);
                  }
                  composeBodyDebounceRef.current = setTimeout(() => {
                    updateState();
                  }, 2000);
                }
              }}
            />
          </div>
          {composeMode !== "new" && composeQuotedText && (
            <div className={composeStyles.composeQuotedToolbar}>
              <Button
                type="button"
                size="1"
                color="gray"
                variant={composeIncludeOriginal ? "solid" : "soft"}
                title="Include the original message as a quote in the reply"
                onClick={toggleIncludeOriginal}
              >
                Include quote
              </Button>
            </div>
          )}
        </>
      )}
      {composeTab === "markdown" && (
        <div className={`${styles.composeWriting} ${styles.composeWritingMarkdown}`}>
          <ComposeMarkdownEditor
            key={`markdown-body-${composeEditorReset}`}
            value={composeMarkdown}
            resetKey={composeEditorReset}
            onChange={(nextMd) => {
              composeMarkdownRef.current = nextMd;
              composeDirtyRef.current = true;
              composeLastEditedRef.current = "markdown";

              const now = Date.now();
              const timeSinceLastUpdate = now - composeBodyLastUpdateRef.current;

              const updateState = () => {
                setComposeMarkdown(nextMd);
                composeBodyLastUpdateRef.current = now;
              };

              if (timeSinceLastUpdate >= 10000) {
                if (composeBodyDebounceRef.current) {
                  clearTimeout(composeBodyDebounceRef.current);
                  composeBodyDebounceRef.current = null;
                }
                updateState();
              } else {
                if (composeBodyDebounceRef.current) {
                  clearTimeout(composeBodyDebounceRef.current);
                }
                composeBodyDebounceRef.current = setTimeout(() => {
                  updateState();
                }, 2000);
              }
            }}
          />
        </div>
      )}
      {composeTab === "html" && (
        <div className={`${styles.composeWriting} ${styles.composeWritingHtml}`}>
          <ComposeEditor
            ref={composeEditorRef}
            initialHtml={composeHtml}
            resetKey={composeEditorReset}
            quotedMessage={{
              visible: hasQuotedContent && composeIncludeOriginal,
              html: previewQuotedHtml,
              quoteHtml: composeQuoteHtml,
              canToggleQuote: hasQuotedParts,
              canStripImages:
                hasQuotedParts && !composeStripImages && /<img\b/i.test(previewQuotedHtml),
              darkMode,
              onEdit: handleEditQuotedHtml,
              onRemove: handleRemoveQuoted,
              onToggleQuote: handleToggleQuotedHtml,
              onStripImages: handleStripImages
            }}
            onInlineImage={handleInlineImage}
            onChange={(nextHtml, nextText) => {
              setComposeHtml(nextHtml);
              setComposeHtmlText(nextText);
              composeEditorInitRef.current = true;
              // Quoted-node syncs and editor seeding fire onChange without
              // altering the exported content — don't mark the draft dirty
              // unless the HTML or text actually changed.
              if (nextHtml === composeHtml && nextText === composeHtmlText) {
                return;
              }
              composeDirtyRef.current = true;
              composeLastEditedRef.current = "html";
            }}
          />
        </div>
      )}
      {visibleComposeAttachments.length > 0 && (
        <div className={composeStyles.composeAttachments}>
          <AttachmentsList
            attachments={visibleComposeAttachments}
            onRemove={removeComposeAttachment}
          />
        </div>
      )}
      {composeTab === "html" && hasQuotedContent && !composeIncludeOriginal && (
        <div className={composeStyles.composeQuotedToolbar}>
          <Button
            type="button"
            size="1"
            color="gray"
            variant="soft"
            title="Include the original message as a quote in the reply"
            onClick={toggleIncludeOriginal}
          >
            Include quote
          </Button>
        </div>
      )}
      {composeTab === "markdown" && hasQuotedContent && (
        <Collapsible.Root
          className={composeStyles.composeQuotedBlock}
          open={isQuotedExpanded}
          onOpenChange={setIsQuotedExpanded}
        >
          <div className={composeStyles.composeQuotedSummary}>
            <Collapsible.Trigger asChild>
              <button
                type="button"
                className={composeStyles.composeQuotedTrigger}
                title={isQuotedExpanded ? "Hide quoted message" : "Show quoted message"}
              >
                <CaretRightIcon className={composeStyles.summaryCaret} />
                <span className={composeStyles.summaryText}>
                  Quoted Message
                </span>
              </button>
            </Collapsible.Trigger>
            <span className={composeStyles.summaryActions}>
              <Button
                type="button"
                size="1"
                color="gray"
                variant={composeIncludeOriginal ? "solid" : "soft"}
                title="Include the original message as a quote in the reply"
                onClick={toggleIncludeOriginal}
              >
                Include quote
              </Button>
              <span className={composeStyles.quoteActions}>
                <Button
                  type="button"
                  size="1"
                  variant="soft"
                  color="gray"
                  title={
                    composeStripImages ? "Images already stripped" : "Strip images from quoted HTML"
                  }
                  disabled={!hasQuotedParts || composeStripImages}
                  onClick={handleStripImages}
                >
                  Strip images
                </Button>
                <Button
                  type="button"
                  size="1"
                  color="gray"
                  variant={composeQuoteHtml ? "solid" : "soft"}
                  title="Toggle HTML quoting"
                  onClick={toggleQuoteHtml}
                  disabled={!hasQuotedParts}
                >
                  Quote HTML
                </Button>
              </span>
            </span>
          </div>
          <Collapsible.Content className={composeStyles.composeQuotedContent}>
            <HtmlMessage html={previewQuotedHtml} darkMode={darkMode} />
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </div>
  );
}
