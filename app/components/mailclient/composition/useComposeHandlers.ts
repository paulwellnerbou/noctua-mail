import { useCallback } from "react";
import type { Message, Attachment } from "@/lib/data";
import { createComposeAttachment } from "@/lib/mail/composeAttachment";
import { isMeaningfulNonInlineAttachment } from "@/lib/messageFlags";

type UseComposeHandlersProps = {
  composeDirtyRef: React.MutableRefObject<boolean>;
  composeDragDepthRef: React.MutableRefObject<number>;
  setComposeDragActive: (active: boolean) => void;
  setComposeAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export function useComposeHandlers({
  composeDirtyRef,
  composeDragDepthRef,
  setComposeDragActive,
  setComposeAttachments,
  apiFetch
}: UseComposeHandlersProps) {
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

  const loadForwardAttachments = async (message: Message, setAttachments: typeof setComposeAttachments) => {
    const toFetch = (message.attachments ?? []).filter(isMeaningfulNonInlineAttachment);
    if (!toFetch.length) return;

    const results = await Promise.all(
      toFetch.map(async (att) => {
        try {
          const res = await apiFetch(
            `/api/attachment?accountId=${encodeURIComponent(message.accountId)}&messageId=${encodeURIComponent(message.id)}&attachmentId=${encodeURIComponent(att.id)}`
          );
          if (!res.ok) return null;
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          return { ...att, dataUrl };
        } catch {
          return null;
        }
      })
    );

    const valid = results.filter((att): att is NonNullable<typeof att> => att !== null);
    if (valid.length > 0) {
      setAttachments(valid);
    }
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
    loadForwardAttachments
  };
}
