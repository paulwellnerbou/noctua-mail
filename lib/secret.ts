import crypto from "crypto";

const SECRET_KEY = process.env.IMAP_SECRET_KEY ?? "";
const STORE_FALLBACK =
  (process.env.STORE_ENCRYPTED_IMAP_PASSWORD_FALLBACK ?? "true").toLowerCase() === "true";

const hasKey = SECRET_KEY.length >= 32;

function getKey(): Buffer {
  return Buffer.from(
    SECRET_KEY.length >= 64 && /^[0-9a-fA-F]+$/.test(SECRET_KEY)
      ? SECRET_KEY
      : crypto.createHash("sha256").update(SECRET_KEY).digest("hex"),
    "hex"
  );
}

export function shouldStorePasswordFallback() {
  return STORE_FALLBACK;
}

export function encodeSecret(value: string): string {
  if (!value) return "";
  if (!STORE_FALLBACK) return "";
  if (!hasKey) return value;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
  } catch {
    return value;
  }
}

export function decodeSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (!value.startsWith("enc:")) return value;
  if (!hasKey) return "";
  try {
    const payload = Buffer.from(value.slice(4), "base64");
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const data = payload.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}
