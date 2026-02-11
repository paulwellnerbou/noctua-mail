import crypto from "crypto";

export function accountIdFromEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const digest = crypto.createHash("sha256").update(normalized).digest("hex");
  return `acc-${digest.slice(0, 24)}`;
}
