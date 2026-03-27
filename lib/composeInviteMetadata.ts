import type { ComposeInviteDraft } from "./composeInvite";

export const COMPOSE_INVITE_HEADER = "x-noctua-compose-invite";

function encodeUtf8Base64(value: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64");
  }
  if (typeof btoa === "function" && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  throw new Error("No base64 encoder available.");
}

function decodeUtf8Base64(value: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf8");
  }
  if (typeof atob === "function" && typeof TextDecoder !== "undefined") {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  throw new Error("No base64 decoder available.");
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function unfoldHeaders(source: string) {
  const lines = normalizeLineEndings(source).split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }
    unfolded.push(line);
  }
  return unfolded;
}

function readHeaderValue(source: string, headerName: string) {
  const normalizedHeaderName = headerName.trim().toLowerCase();
  for (const line of unfoldHeaders(source)) {
    if (!line.trim()) break;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (key !== normalizedHeaderName) continue;
    return line.slice(separator + 1).trim();
  }
  return "";
}

export function encodeComposeInviteHeader(invite: ComposeInviteDraft) {
  return encodeUtf8Base64(JSON.stringify(invite));
}

function isValidComposeInviteDraft(value: unknown): value is ComposeInviteDraft {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.start !== "string") return false;
  if (typeof record.end !== "string") return false;
  if (typeof record.allDay !== "boolean") return false;
  for (const key of Object.keys(record)) {
    if (key === "start" || key === "end" || key === "allDay") continue;
    const field = record[key];
    if (field !== undefined && field !== null && typeof field !== "string") return false;
  }
  return true;
}

export function decodeComposeInviteHeader(value?: string | null): ComposeInviteDraft | null {
  const encoded = value?.trim();
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeUtf8Base64(encoded));
    return isValidComposeInviteDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractComposeInviteDraftFromSource(source: string): ComposeInviteDraft | null {
  if (!source.trim()) return null;
  return decodeComposeInviteHeader(readHeaderValue(source, COMPOSE_INVITE_HEADER));
}
