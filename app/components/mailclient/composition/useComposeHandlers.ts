import { useCallback } from "react";
import { buildAccountAttachmentPath } from "@/lib/accountApiPaths";
import type { Message, Attachment } from "@/lib/data";
import { replaceInlineImageSources } from "@/lib/html";
import { createComposeAttachment } from "@/lib/mail/composeAttachment";

type UseComposeHandlersProps = {
  composeDirtyRef: React.MutableRefObject<boolean>;
  composeDragDepthRef: React.MutableRefObject<number>;
  setComposeDragActive: (active: boolean) => void;
  setComposeAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceQuotedHtmlValue(html: string, target: string, replacement: string) {
  if (!html || !target || target === replacement) return html;
  return html.replace(
    new RegExp(`(["'])${escapeRegExp(target)}\\1`, "g"),
    (_match, quote: string) => `${quote}${replacement}${quote}`
  );
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function restoreInlineAttachmentDataUrls(html: string, attachments: Attachment[]) {
  let nextHtml = html;
  attachments.forEach((attachment) => {
    if (!attachment.inline || !attachment.url || !attachment.dataUrl) return;
    nextHtml = replaceQuotedHtmlValue(nextHtml, attachment.url, attachment.dataUrl);
  });
  return replaceInlineImageSources(
    nextHtml,
    attachments
      .filter((attachment) => attachment.inline && attachment.dataUrl)
      .map((attachment) => ({ ...attachment, url: attachment.dataUrl }))
  );
}

export function restoreComposeMessageAttachmentDataUrls(
  message: Message,
  attachments: Attachment[]
): Message {
  if (!message.htmlBody || attachments.length === 0) return message;
  return {
    ...message,
    htmlBody: restoreInlineAttachmentDataUrls(message.htmlBody, attachments)
  };
}

export function pruneUnreferencedInlineAttachments(attachments: Attachment[], html: string) {
  const inlineAttachments = attachments.filter((attachment) => attachment.inline);
  if (inlineAttachments.length === 0) return attachments;

  const keep = new Set(
    inlineAttachments
      .filter((attachment) => attachment.dataUrl && html.includes(attachment.dataUrl))
      .map((attachment) => attachment.id)
  );
  const next = attachments.filter((attachment) => !attachment.inline || keep.has(attachment.id));
  return next.length === attachments.length ? attachments : next;
}

export function useComposeHandlers({
  composeDirtyRef,
  composeDragDepthRef,
  setComposeDragActive,
  setComposeAttachments,
  apiFetch
}: UseComposeHandlersProps) {
  const hydrateComposeAttachments = useCallback(async (
    message: Message,
    options?: { filter?: (attachment: Attachment) => boolean }
  ) => {
    const toFetch = (message.attachments ?? []).filter(
      options?.filter ?? (() => true)
    );
    if (!toFetch.length) return [];

    const results = await Promise.all(
      toFetch.map(async (attachment) => {
        try {
          const res = await apiFetch(
            buildAccountAttachmentPath(message.accountId, message.id, attachment.id)
          );
          if (!res.ok) return null;
          const dataUrl = await readBlobAsDataUrl(await res.blob());
          return { ...attachment, dataUrl };
        } catch {
          return null;
        }
      })
    );

    return results.filter((attachment): attachment is NonNullable<typeof attachment> => attachment !== null);
  }, [apiFetch]);

  const addComposeFiles = async (files: File[], inline = false, dataUrlOverride?: string) => {
    if (files.length === 0) return;
    const attachments = await Promise.all(
      files.map((file) => createComposeAttachment(file, inline, dataUrlOverride))
    );
    composeDirtyRef.current = true;
    setComposeAttachments((prev) => [...prev, ...attachments]);
  };

  const removeComposeAttachment = (attachmentId: string) => {
    composeDirtyRef.current = true;
    setComposeAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const handleInlineImage = useCallback(async (file: File, dataUrl: string) => {
    const attachment = await createComposeAttachment(file, true, dataUrl);
    composeDirtyRef.current = true;
    setComposeAttachments((prev) => [...prev, attachment]);
  }, [composeDirtyRef, setComposeAttachments]);

  const handleComposeDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    composeDragDepthRef.current += 1;
    setComposeDragActive(true);
  };

  const handleComposeDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    composeDragDepthRef.current = Math.max(0, composeDragDepthRef.current - 1);
    if (composeDragDepthRef.current === 0) {
      setComposeDragActive(false);
    }
  };

  const handleComposeDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleComposeDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    composeDragDepthRef.current = 0;
    setComposeDragActive(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    await addComposeFiles(files, false);
  };

  const handleComposeAttachmentPick = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    await addComposeFiles(files, false);
    event.target.value = "";
  };

  const loadForwardAttachments = async (message: Message) => {
    const attachments = await hydrateComposeAttachments(message);
    return {
      attachments,
      message: restoreComposeMessageAttachmentDataUrls(message, attachments)
    };
  };

  return {
    addComposeFiles,
    removeComposeAttachment,
    handleInlineImage,
    handleComposeDragEnter,
    handleComposeDragLeave,
    handleComposeDragOver,
    handleComposeDrop,
    handleComposeAttachmentPick,
    hydrateComposeAttachments,
    loadForwardAttachments
  };
}
