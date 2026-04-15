import { describe, expect, it } from "bun:test";
import { spawnSync } from "child_process";
import { encodeSecret, decodeSecret } from "./secret";

describe("encodeSecret/decodeSecret", () => {
  it("round-trips a value when the key is set", () => {
    const encoded = encodeSecret("my-imap-password");
    expect(encoded.startsWith("enc:")).toBe(true);
    expect(decodeSecret(encoded)).toBe("my-imap-password");
  });

  it("returns empty for empty input", () => {
    expect(encodeSecret("")).toBe("");
    expect(decodeSecret("")).toBe("");
    expect(decodeSecret(null)).toBe("");
    expect(decodeSecret(undefined)).toBe("");
  });

  it("does not re-encrypt already-encoded values", () => {
    const encoded = encodeSecret("value");
    expect(encodeSecret(encoded)).toBe(encoded);
  });

  it("throws when DB storage is configured but IMAP_SECRET_KEY is missing", () => {
    // Run in a subprocess so the secret module initializes with an empty key.
    const result = spawnSync(
      "bun",
      [
        "-e",
        "import('./lib/secret').then((m) => { try { m.encodeSecret('pw'); console.log('NO_THROW'); } catch (err) { console.log('THREW:' + (err?.message ?? err)); } });"
      ],
      {
        env: { ...process.env, IMAP_SECRET_KEY: "", IMAP_CREDENTIALS_STORAGE: "db" },
        encoding: "utf8"
      }
    );
    expect(result.status).toBe(0);
    // Module startup prints the missing-key warning to stderr on purpose.
    expect(result.stderr).toContain("IMAP_SECRET_KEY");
    expect(result.stdout).toContain("THREW:");
    expect(result.stdout).toContain("IMAP_SECRET_KEY");
  });
});
