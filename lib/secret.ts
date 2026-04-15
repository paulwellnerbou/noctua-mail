import crypto from "crypto";

const SECRET_KEY = process.env.IMAP_SECRET_KEY ?? "";
const IMAP_CREDENTIALS_STORAGE = (process.env.IMAP_CREDENTIALS_STORAGE ?? "both").toLowerCase();
const STORE_IN_DB =
  IMAP_CREDENTIALS_STORAGE === "db" || IMAP_CREDENTIALS_STORAGE === "both";
const STORE_IN_COOKIE =
  IMAP_CREDENTIALS_STORAGE === "cookie" || IMAP_CREDENTIALS_STORAGE === "both";

const hasKey = SECRET_KEY.length >= 32;

const MISSING_KEY_MESSAGE =
  "IMAP_SECRET_KEY must be at least 32 characters when IMAP_CREDENTIALS_STORAGE " +
  "includes database storage ('db' or 'both'). Set a strong key, or set " +
  "IMAP_CREDENTIALS_STORAGE=cookie to skip DB storage.";

// Called once from instrumentation.ts when the server boots. Throwing here
// fails the server start-up so a misconfigured deployment cannot silently
// store plaintext passwords. encodeSecret/decodeSecret keep their own
// throw-on-use guards as defense-in-depth for any code path that doesn't
// go through the instrumentation hook (tests, scripts, workers).
export function assertImapSecretKeyConfigured(): void {
  if (STORE_IN_DB && !hasKey) {
    throw new Error(MISSING_KEY_MESSAGE);
  }
}

function getKey(): Buffer {
  return Buffer.from(
    SECRET_KEY.length >= 64 && /^[0-9a-fA-F]+$/.test(SECRET_KEY)
      ? SECRET_KEY
      : crypto.createHash("sha256").update(SECRET_KEY).digest("hex"),
    "hex"
  );
}

export function shouldStorePasswordInDb() {
  return STORE_IN_DB;
}

export function shouldIncludeSessionCredentials() {
  return STORE_IN_COOKIE;
}

function looksLikeEncryptedPayload(value: string): boolean {
  if (!value.startsWith("enc:")) return false;
  try {
    // A valid payload is iv (12) + tag (16) + at least 1 byte ciphertext = 29 bytes.
    const decoded = Buffer.from(value.slice(4), "base64");
    return decoded.length >= 29;
  } catch {
    return false;
  }
}

export function encodeSecret(value: string): string {
  if (!value) return "";
  if (!STORE_IN_DB) return "";
  if (looksLikeEncryptedPayload(value)) return value;
  if (!hasKey) throw new Error(MISSING_KEY_MESSAGE);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

function decryptPayload(payload: Buffer): string {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const data = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

export function decodeSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (!STORE_IN_DB) return "";
  if (!value.startsWith("enc:")) return value;
  if (!hasKey) throw new Error(MISSING_KEY_MESSAGE);
  let decoded: string;
  try {
    decoded = decryptPayload(Buffer.from(value.slice(4), "base64"));
  } catch (err) {
    throw new Error("Failed to decrypt stored IMAP secret", { cause: err });
  }
  // Handle legacy accidental double-encryption by unwrapping one extra layer.
  if (decoded.startsWith("enc:")) {
    try {
      return decryptPayload(Buffer.from(decoded.slice(4), "base64"));
    } catch {
      return decoded;
    }
  }
  return decoded;
}
