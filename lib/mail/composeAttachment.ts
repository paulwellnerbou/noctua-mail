import type { Attachment } from "@/lib/data";

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function createComposeAttachment(
  file: File,
  inline: boolean,
  dataUrlOverride?: string
): Promise<Attachment> {
  const dataUrl = dataUrlOverride ?? (await readFileAsDataUrl(file));
  const contentType = file.type || "application/octet-stream";
  const id = crypto.randomUUID();
  return {
    id,
    filename: file.name || `attachment-${id}`,
    contentType,
    size: file.size,
    inline,
    cid: inline ? `inline-${id}@noctua` : undefined,
    dataUrl
  };
}
