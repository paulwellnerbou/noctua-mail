import type { ImapFlow, ImapFlowOptions } from "imapflow";
import tls from "tls";

import type { Account } from "@/lib/data";
import { getImapLogger } from "./imapLogger";

export type ImapClientLogContext = {
  accountId?: string;
  clientId?: string;
  mailbox?: string;
};

const DEFAULT_SOCKET_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 90 * 1000;
const DEFAULT_GREETING_TIMEOUT_MS = 16 * 1000;

const parsePositiveMs = (rawValue: string | undefined, fallback: number) => {
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export function getImapTimeoutOptions() {
  return {
    connectionTimeout: parsePositiveMs(
      process.env.IMAP_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS
    ),
    greetingTimeout: parsePositiveMs(
      process.env.IMAP_GREETING_TIMEOUT_MS,
      DEFAULT_GREETING_TIMEOUT_MS
    ),
    socketTimeout: parsePositiveMs(process.env.IMAP_SOCKET_TIMEOUT_MS, DEFAULT_SOCKET_TIMEOUT_MS)
  };
}

export function buildImapFlowOptions(
  account: Account,
  overrides: Partial<ImapFlowOptions> = {}
): ImapFlowOptions {
  const baseAuth = {
    user: account.imap.user,
    pass: account.imap.password
  };
  const baseTls: NonNullable<ImapFlowOptions["tls"]> = {
    servername: account.imap.host,
    checkServerIdentity: (hostname, cert) => {
      // Some IMAP servers (e.g. certain IONOS backends) present CN-only certs
      // with no Subject Alternative Names. Node 17+ / Bun dropped CN fallback,
      // so tls.checkServerIdentity throws "Cert does not contain a DNS name".
      // Re-implement the CN fallback for these legacy certs.
      if (!cert?.subjectaltname) {
        const cn = (cert as { subject?: { CN?: string } } | undefined)?.subject?.CN;
        if (!cn) return undefined; // cert is empty or unusable; TLS authorized flag stands
        if (cn === hostname) return undefined;
        if (cn.startsWith("*.") && hostname.endsWith(cn.slice(1))) return undefined;
        return new Error(`Hostname "${hostname}" does not match certificate CN "${cn}"`);
      }
      return tls.checkServerIdentity(hostname, cert);
    }
  };

  return {
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    logger: getImapLogger(),
    ...getImapTimeoutOptions(),
    ...overrides,
    auth: {
      ...baseAuth,
      ...(overrides.auth ?? {})
    },
    tls: {
      ...baseTls,
      ...(overrides.tls ?? {})
    }
  };
}

export function bindImapClientError(client: ImapFlow, context: ImapClientLogContext = {}) {
  const logger = getImapLogger();
  client.on("error", (error) => {
    if (logger === false) return;
    const meta = [
      context.mailbox ? `mailbox=${context.mailbox}` : "",
      context.accountId ? `account=${context.accountId}` : "",
      context.clientId ? `client=${context.clientId}` : ""
    ]
      .filter(Boolean)
      .join(" ");
    const suffix = meta ? ` ${meta}` : "";
    logger.warn?.(
      `[imap] client.error${suffix} error=${(error as Error)?.message ?? String(error)}`
    );
  });
}
