import { useState } from "react";
import type React from "react";
import {
  Check,
  Copy,
  Edit3,
  Image as ImageIcon,
  Paperclip,
  Pin,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { Message } from "@/lib/data";
import AttachmentsList from "../../AttachmentsList";
import HtmlMessage from "../../HtmlMessage";
import QuoteRenderer from "../../QuoteRenderer";

type MessageTab = "html" | "text" | "markdown" | "source";

type ImapFlagBadge = { label: string; kind: string };

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type ThreadMessageCardProps = {
  message: Message;
  openMessageMenuId: string | null;
  messageRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  pendingMessageActions: Set<string>;
  includeThreadAcrossFolders: boolean;
  activeFolderId: string;
  threadPathById: (folderId: string) => string;
  folderNameById: (folderId: string) => string;
  setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
  setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
  getImapFlagBadges: (message: Message) => ImapFlagBadge[];
  isDraftMessage: (message: Message) => boolean;
  openCompose: (mode: ComposeMode, message?: Message) => void;
  renderQuickActions: (
    message: Message,
    iconSize?: number,
    origin?: "list" | "table" | "thread"
  ) => React.ReactNode;
  renderMessageMenu: (message: Message, view: "thread" | "table" | "list") => React.ReactNode;
  collapsedMessages: Record<string, boolean>;
  setCollapsedMessages: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  messageTabs: Record<string, MessageTab>;
  setMessageTabs: React.Dispatch<React.SetStateAction<Record<string, MessageTab>>>;
  fetchSource: (id: string) => void;
  setMessageFontScale: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  messageFontScale: Record<string, number>;
  adjustMessageZoom: (messageId: string, delta: number) => void;
  resetMessageZoom: (messageId: string) => void;
  messageZoom: Record<string, number>;
  darkMode: boolean;
  hasHtmlContent: (html?: string) => boolean;
  renderMarkdownPanel: (body: string | undefined, messageId: string) => React.ReactNode;
  renderSourcePanel: (messageId: string) => React.ReactNode;
  handleSelectMessage: (message: Message) => void;
  messageByMessageId: Map<string, Message>;
  copyStatus: Record<string, boolean>;
  triggerCopy: (key: string, value: string) => void;
  getPrimaryEmail: (value?: string) => string | null;
  extractEmails: (value?: string) => string[];
};

export default function ThreadMessageCard({
  message,
  openMessageMenuId,
  messageRefs,
  pendingMessageActions,
  includeThreadAcrossFolders,
  activeFolderId,
  threadPathById,
  folderNameById,
  setSearchScope,
  setActiveFolderId,
  getImapFlagBadges,
  isDraftMessage,
  openCompose,
  renderQuickActions,
  renderMessageMenu,
  collapsedMessages,
  setCollapsedMessages,
  messageTabs,
  setMessageTabs,
  fetchSource,
  setMessageFontScale,
  messageFontScale,
  adjustMessageZoom,
  resetMessageZoom,
  messageZoom,
  darkMode,
  hasHtmlContent,
  renderMarkdownPanel,
  renderSourcePanel,
  handleSelectMessage,
  messageByMessageId,
  copyStatus,
  triggerCopy,
  getPrimaryEmail,
  extractEmails
}: ThreadMessageCardProps) {
  const [toExpanded, setToExpanded] = useState(false);
  const toValue = message.to ?? "";
  const showToToggle = toValue.length > 120;
  return (
    <article
      className={`thread-card ${openMessageMenuId === `thread:${message.id}` ? "menu-open" : ""}`}
      ref={(el) => {
        if (el) messageRefs.current.set(message.id, el);
      }}
    >
      <div
        className={`thread-card-header ${
          pendingMessageActions.has(message.id) ? "disabled" : ""
        }`}
      >
        <div className="thread-card-top">
          <div className="thread-card-badges">
            {getImapFlagBadges(message).map((badge) => (
              <span
                key={`${badge.kind}-${badge.label}`}
                className={`thread-badge flag ${badge.kind}`}
              >
                {badge.kind === "pinned" && <Pin size={12} />}
                {badge.label}
              </span>
            ))}
            {includeThreadAcrossFolders && message.folderId !== activeFolderId && (
              <button
                className="folder-badge"
                title={threadPathById(message.folderId)}
                onClick={(event) => {
                  event.stopPropagation();
                  setSearchScope("folder");
                  setActiveFolderId(message.folderId);
                }}
              >
                {folderNameById(message.folderId)}
              </button>
            )}
            {message.recent && <span className="thread-badge flag recent">Recent</span>}
            {message.priority && message.priority.toLowerCase() !== "normal" && (
              <span className="thread-badge priority">Priority: {message.priority}</span>
            )}
            {(message.hasAttachments ??
              (message.attachments?.length ?? 0) > 0) && (
              <span className="thread-badge icon attachment" title="Attachments">
                <Paperclip size={12} />
              </span>
            )}
            {(message.hasInlineAttachments ??
              message.attachments?.some((item) => item.inline)) && (
              <span className="thread-badge icon inline" title="Inline images">
                <ImageIcon size={12} />
              </span>
            )}
          </div>
          <div className="thread-card-actions">
            <div className="message-actions">
              {isDraftMessage(message) ? (
                <button
                  className="icon-button ghost"
                  title="Edit draft"
                  aria-label="Edit draft"
                  onClick={() => openCompose("edit", message)}
                >
                  <Edit3 size={14} />
                </button>
              ) : (
                renderQuickActions(message, 14, "thread")
              )}
            </div>
            {renderMessageMenu(message, "thread")}
          </div>
        </div>
        <div className="thread-card-info">
          <button
            className="thread-card-subject"
            onClick={() =>
              setCollapsedMessages((prev) => ({
                ...prev,
                [message.id]: !prev[message.id]
              }))
            }
            title={collapsedMessages[message.id] ? "Expand message" : "Collapse message"}
          >
            <span className="thread-card-caret">
              {collapsedMessages[message.id] ? "▸" : "▾"}
            </span>
            <span className="thread-card-subject-text">{message.subject}</span>
          </button>
          <div className="thread-card-line">
            <span className="label">From:</span>
            <span className="thread-card-value">{message.from}</span>
            {getPrimaryEmail(message.from) && (
              <button
                className={`icon-button ghost small copy-email ${
                  copyStatus[`from-${message.id}`] ? "ok" : ""
                }`}
                title="Copy email"
                aria-label="Copy email"
                onClick={() => triggerCopy(`from-${message.id}`, getPrimaryEmail(message.from) ?? "")}
              >
                {copyStatus[`from-${message.id}`] ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
          </div>
          <div className="thread-card-line thread-card-line-to">
            <span className="label">To:</span>
            <div className="thread-card-to-wrapper">
              <span
                className={`thread-card-value thread-card-to ${toExpanded ? "expanded" : ""}`}
              >
                {toValue}
              </span>
              {showToToggle && (
                <button
                  className="thread-card-more"
                  type="button"
                  onClick={() => setToExpanded((prev) => !prev)}
                >
                  {toExpanded ? "less..." : "more..."}
                </button>
              )}
            </div>
            {extractEmails(message.to).length > 0 && (
              <button
                className={`icon-button ghost small copy-email ${
                  copyStatus[`to-${message.id}`] ? "ok" : ""
                }`}
                title="Copy emails"
                aria-label="Copy emails"
                onClick={() =>
                  triggerCopy(`to-${message.id}`, extractEmails(message.to).join(", "))
                }
              >
                {copyStatus[`to-${message.id}`] ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
          </div>
          <div className="thread-card-line">
            <span className="label">Date:</span> {message.date}
          </div>
          {(() => {
            const refId =
              message.inReplyTo ??
              (message.references && message.references.length > 0
                ? message.references[message.references.length - 1]
                : undefined);
            const target =
              refId && messageByMessageId.has(refId) ? messageByMessageId.get(refId) : null;
            return refId && target ? (
              <div className="thread-card-line thread-card-line-link">
                <span className="label">
                  {message.xForwardedMessageId ? "Forwarded mail:" : "In Reply To:"}
                </span>
                <button
                  className="thread-link"
                  onClick={() => {
                    if (target) {
                      handleSelectMessage(target);
                    }
                  }}
                >
                  {target?.subject ?? refId}
                </button>
              </div>
            ) : null;
          })()}
        </div>
      </div>
      {!collapsedMessages[message.id] && (
        <>
          {hasHtmlContent(message.htmlBody) && message.body?.trim() ? (
            <>
              <div className="message-tabs">
                <div className="button-group">
                  <button
                    className={`icon-button small ${
                      (messageTabs[message.id] ?? "html") === "html" ? "active" : ""
                    }`}
                    onClick={() =>
                      setMessageTabs((prev) => ({ ...prev, [message.id]: "html" }))
                    }
                  >
                    HTML
                  </button>
                  <button
                    className={`icon-button small ${
                      (messageTabs[message.id] ?? "html") === "text" ? "active" : ""
                    }`}
                    onClick={() =>
                      setMessageTabs((prev) => ({ ...prev, [message.id]: "text" }))
                    }
                  >
                    Text
                  </button>
                  <button
                    className={`icon-button small ${
                      (messageTabs[message.id] ?? "html") === "markdown" ? "active" : ""
                    }`}
                    onClick={() =>
                      setMessageTabs((prev) => ({ ...prev, [message.id]: "markdown" }))
                    }
                  >
                    Markdown
                  </button>
                  <button
                    className={`icon-button small ${
                      (messageTabs[message.id] ?? "html") === "source" ? "active" : ""
                    }`}
                    onClick={() =>
                      setMessageTabs((prev) => ({ ...prev, [message.id]: "source" }))
                    }
                    onMouseDown={() => fetchSource(message.id)}
                  >
                    Source
                  </button>
                </div>
                {(messageTabs[message.id] ?? "html") !== "source" && (
                  <div className="message-zoom">
                    <div className="button-group">
                      <button
                        className="icon-button small"
                        title="Decrease text size"
                        aria-label="Decrease text size"
                        onClick={() =>
                          setMessageFontScale((prev) => {
                            const current = prev[message.id] ?? 1;
                            const next = Math.max(0.8, Number((current - 0.1).toFixed(2)));
                            return { ...prev, [message.id]: next };
                          })
                        }
                      >
                        A-
                      </button>
                      <button
                        className="icon-button small"
                        title="Reset text size"
                        aria-label="Reset text size"
                        onClick={() =>
                          setMessageFontScale((prev) => {
                            if (!(message.id in prev)) return prev;
                            const { [message.id]: _omit, ...rest } = prev;
                            return rest;
                          })
                        }
                      >
                        A
                      </button>
                      <button
                        className="icon-button small"
                        title="Increase text size"
                        aria-label="Increase text size"
                        onClick={() =>
                          setMessageFontScale((prev) => {
                            const current = prev[message.id] ?? 1;
                            const next = Math.min(1.6, Number((current + 0.1).toFixed(2)));
                            return { ...prev, [message.id]: next };
                          })
                        }
                      >
                        A+
                      </button>
                    </div>
                    {(messageTabs[message.id] ?? "html") === "html" && (
                      <div className="button-group">
                        <button
                          className="icon-button small"
                          title="Zoom out"
                          aria-label="Zoom out"
                          onClick={() => adjustMessageZoom(message.id, -0.1)}
                        >
                          <ZoomOut size={12} />
                        </button>
                        <button
                          className="icon-button small"
                          title="Reset zoom"
                          aria-label="Reset zoom"
                          onClick={() => resetMessageZoom(message.id)}
                        >
                          100%
                        </button>
                        <button
                          className="icon-button small"
                          title="Zoom in"
                          aria-label="Zoom in"
                          onClick={() => adjustMessageZoom(message.id, 0.1)}
                        >
                          <ZoomIn size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {(messageTabs[message.id] ?? "html") === "html" ? (
                <div className="html-message-wrapper">
                  <HtmlMessage
                    html={message.htmlBody ?? ""}
                    darkMode={darkMode}
                    fontScale={messageFontScale[message.id] ?? 1}
                    zoom={messageZoom[message.id] ?? 1}
                  />
                </div>
              ) : (messageTabs[message.id] ?? "html") === "text" ? (
                <div
                  className="text-view"
                  style={{ fontSize: `${14 * (messageFontScale[message.id] ?? 1)}px` }}
                >
                  <QuoteRenderer body={message.body} />
                </div>
              ) : (messageTabs[message.id] ?? "html") === "markdown" ? (
                renderMarkdownPanel(message.body, message.id)
              ) : (
                renderSourcePanel(message.id)
              )}
            </>
          ) : hasHtmlContent(message.htmlBody) ? (
            message.hasSource ? (
              <>
                <div className="message-tabs">
                  <div className="button-group">
                    <button
                      className={`icon-button small ${
                        (messageTabs[message.id] ?? "html") === "html" ? "active" : ""
                      }`}
                      onClick={() =>
                        setMessageTabs((prev) => ({ ...prev, [message.id]: "html" }))
                      }
                    >
                      HTML
                    </button>
                    <button
                      className={`icon-button small ${
                        (messageTabs[message.id] ?? "html") === "source" ? "active" : ""
                      }`}
                      onClick={() =>
                        setMessageTabs((prev) => ({ ...prev, [message.id]: "source" }))
                      }
                      onMouseDown={() => fetchSource(message.id)}
                    >
                      Source
                    </button>
                  </div>
                  {(messageTabs[message.id] ?? "html") !== "source" && (
                    <div className="message-zoom">
                      <div className="button-group">
                        <button
                          className="icon-button small"
                          title="Decrease text size"
                          aria-label="Decrease text size"
                          onClick={() =>
                            setMessageFontScale((prev) => {
                              const current = prev[message.id] ?? 1;
                              const next = Math.max(0.8, Number((current - 0.1).toFixed(2)));
                              return { ...prev, [message.id]: next };
                            })
                          }
                        >
                          A-
                        </button>
                        <button
                          className="icon-button small"
                          title="Reset text size"
                          aria-label="Reset text size"
                          onClick={() =>
                            setMessageFontScale((prev) => {
                              if (!(message.id in prev)) return prev;
                              const { [message.id]: _omit, ...rest } = prev;
                              return rest;
                            })
                          }
                        >
                          A
                        </button>
                        <button
                          className="icon-button small"
                          title="Increase text size"
                          aria-label="Increase text size"
                          onClick={() =>
                            setMessageFontScale((prev) => {
                              const current = prev[message.id] ?? 1;
                              const next = Math.min(1.6, Number((current + 0.1).toFixed(2)));
                              return { ...prev, [message.id]: next };
                            })
                          }
                        >
                          A+
                        </button>
                      </div>
                      {(messageTabs[message.id] ?? "html") === "html" && (
                        <div className="button-group">
                          <button
                            className="icon-button small"
                            title="Zoom out"
                            aria-label="Zoom out"
                            onClick={() => adjustMessageZoom(message.id, -0.1)}
                          >
                            <ZoomOut size={12} />
                          </button>
                          <button
                            className="icon-button small"
                            title="Reset zoom"
                            aria-label="Reset zoom"
                            onClick={() => resetMessageZoom(message.id)}
                          >
                            100%
                          </button>
                          <button
                            className="icon-button small"
                            title="Zoom in"
                            aria-label="Zoom in"
                            onClick={() => adjustMessageZoom(message.id, 0.1)}
                          >
                            <ZoomIn size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {(messageTabs[message.id] ?? "html") === "html" ? (
                  <div className="html-message-wrapper">
                    <HtmlMessage
                      html={message.htmlBody ?? ""}
                      darkMode={darkMode}
                      fontScale={messageFontScale[message.id] ?? 1}
                      zoom={messageZoom[message.id] ?? 1}
                    />
                  </div>
                ) : (
                  renderSourcePanel(message.id)
                )}
              </>
            ) : (
              <div className="html-message-wrapper">
                <HtmlMessage
                  html={message.htmlBody ?? ""}
                  darkMode={darkMode}
                  fontScale={messageFontScale[message.id] ?? 1}
                  zoom={messageZoom[message.id] ?? 1}
                />
              </div>
            )
          ) : message.hasSource ? (
            <>
              <div className="message-tabs">
                <div className="button-group">
                  <button
                    className={`icon-button small ${
                      (messageTabs[message.id] ?? "text") === "text" ? "active" : ""
                    }`}
                    onClick={() =>
                      setMessageTabs((prev) => ({ ...prev, [message.id]: "text" }))
                    }
                  >
                    Text
                  </button>
                  <button
                    className={`icon-button small ${
                      (messageTabs[message.id] ?? "text") === "markdown" ? "active" : ""
                    }`}
                    onClick={() =>
                      setMessageTabs((prev) => ({ ...prev, [message.id]: "markdown" }))
                    }
                  >
                    Markdown
                  </button>
                  <button
                    className={`icon-button small ${
                      (messageTabs[message.id] ?? "text") === "source" ? "active" : ""
                    }`}
                    onClick={() =>
                      setMessageTabs((prev) => ({ ...prev, [message.id]: "source" }))
                    }
                    onMouseDown={() => fetchSource(message.id)}
                  >
                    Source
                  </button>
                </div>
                {(messageTabs[message.id] ?? "text") !== "source" && (
                  <div className="message-zoom">
                    <button
                      className="icon-button small"
                      title="Decrease text size"
                      aria-label="Decrease text size"
                      onClick={() =>
                        setMessageFontScale((prev) => {
                          const current = prev[message.id] ?? 1;
                          const next = Math.max(0.8, Number((current - 0.1).toFixed(2)));
                          return { ...prev, [message.id]: next };
                        })
                      }
                    >
                      A-
                    </button>
                    <button
                      className="icon-button small"
                      title="Reset text size"
                      aria-label="Reset text size"
                      onClick={() =>
                        setMessageFontScale((prev) => {
                          if (!(message.id in prev)) return prev;
                          const { [message.id]: _omit, ...rest } = prev;
                          return rest;
                        })
                      }
                    >
                      A
                    </button>
                    <button
                      className="icon-button small"
                      title="Increase text size"
                      aria-label="Increase text size"
                      onClick={() =>
                        setMessageFontScale((prev) => {
                          const current = prev[message.id] ?? 1;
                          const next = Math.min(1.6, Number((current + 0.1).toFixed(2)));
                          return { ...prev, [message.id]: next };
                        })
                      }
                    >
                      A+
                    </button>
                  </div>
                )}
              </div>
              {(messageTabs[message.id] ?? "text") === "text" ? (
                <div
                  className="text-view"
                  style={{ fontSize: `${14 * (messageFontScale[message.id] ?? 1)}px` }}
                >
                  <QuoteRenderer body={message.body} />
                </div>
              ) : (messageTabs[message.id] ?? "text") === "markdown" ? (
                renderMarkdownPanel(message.body, message.id)
              ) : (
                renderSourcePanel(message.id)
              )}
            </>
          ) : (
            <>
              <div className="message-tabs">
                <div className="button-group">
                  <button
                    className={`icon-button small ${
                      (messageTabs[message.id] ?? "text") === "text" ? "active" : ""
                    }`}
                    onClick={() =>
                      setMessageTabs((prev) => ({ ...prev, [message.id]: "text" }))
                    }
                  >
                    Text
                  </button>
                  <button
                    className={`icon-button small ${
                      (messageTabs[message.id] ?? "text") === "markdown" ? "active" : ""
                    }`}
                    onClick={() =>
                      setMessageTabs((prev) => ({ ...prev, [message.id]: "markdown" }))
                    }
                  >
                    Markdown
                  </button>
                </div>
                <div className="message-zoom">
                  <button
                    className="icon-button small"
                    title="Decrease text size"
                    aria-label="Decrease text size"
                    onClick={() =>
                      setMessageFontScale((prev) => {
                        const current = prev[message.id] ?? 1;
                        const next = Math.max(0.8, Number((current - 0.1).toFixed(2)));
                        return { ...prev, [message.id]: next };
                      })
                    }
                  >
                    A-
                  </button>
                  <button
                    className="icon-button small"
                    title="Reset text size"
                    aria-label="Reset text size"
                    onClick={() =>
                      setMessageFontScale((prev) => {
                        if (!(message.id in prev)) return prev;
                        const { [message.id]: _omit, ...rest } = prev;
                        return rest;
                      })
                    }
                  >
                    A
                  </button>
                  <button
                    className="icon-button small"
                    title="Increase text size"
                    aria-label="Increase text size"
                    onClick={() =>
                      setMessageFontScale((prev) => {
                        const current = prev[message.id] ?? 1;
                        const next = Math.min(1.6, Number((current + 0.1).toFixed(2)));
                        return { ...prev, [message.id]: next };
                      })
                    }
                  >
                    A+
                  </button>
                </div>
              </div>
              {(messageTabs[message.id] ?? "text") === "markdown" ? (
                renderMarkdownPanel(message.body, message.id)
              ) : (
                <div
                  className="text-view"
                  style={{ fontSize: `${14 * (messageFontScale[message.id] ?? 1)}px` }}
                >
                  <QuoteRenderer body={message.body} />
                </div>
              )}
            </>
          )}
          <AttachmentsList attachments={message.attachments ?? []} />
        </>
      )}
    </article>
  );
}

export type { ThreadMessageCardProps };
