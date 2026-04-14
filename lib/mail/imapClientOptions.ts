import type { ImapFlow, ImapFlowOptions } from "imapflow";
import tls from "tls";

import type { Account } from "@/lib/data";
import { getImapLogger, logImapOp } from "./imapLogger";

export type ImapClientLogContext = {
  accountId?: string;
  clientId?: string;
  mailbox?: string;
};

type TlsCheckFailureReason = "missing-san-and-cn" | "cn-mismatch" | "tls-check-failed";
type TlsIdentityCheckFailureReason =
  | TlsCheckFailureReason
  | "empty-peer-certificate"
  | "missing-peer-certificate";

const CONNECT_DIAGNOSTICS_BOUND = Symbol("imapConnectDiagnosticsBound");
const SOCKET_DIAGNOSTICS_BOUND = Symbol("imapSocketDiagnosticsBound");

const DEFAULT_SOCKET_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 90 * 1000;
const DEFAULT_GREETING_TIMEOUT_MS = 16 * 1000;
const DEFAULT_IMAP_CONNECT_RETRY_COUNT = 2;
const DEFAULT_IMAP_CONNECT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_IMAP_CONNECT_RETRY_MAX_DELAY_MS = 2_000;
const DEFAULT_IMAP_CONNECT_BREAKER_THRESHOLD = 3;
const DEFAULT_IMAP_CONNECT_BREAKER_COOLDOWN_MS = 30_000;

type ImapConnectCircuitState = {
  consecutiveFailures: number;
  openedUntil: number;
  lastError?: string;
};

const imapConnectRuntimeState = globalThis as typeof globalThis & {
  __noctuaImapConnectCircuitState?: Map<string, ImapConnectCircuitState>;
};

if (!imapConnectRuntimeState.__noctuaImapConnectCircuitState) {
  imapConnectRuntimeState.__noctuaImapConnectCircuitState = new Map();
}

const imapConnectCircuitState = imapConnectRuntimeState.__noctuaImapConnectCircuitState;

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

const parseRetryCount = (rawValue: string | undefined, fallback: number) => {
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

function getImapConnectRetryOptions() {
  return {
    retryCount: parseRetryCount(
      process.env.IMAP_CONNECT_RETRY_COUNT,
      DEFAULT_IMAP_CONNECT_RETRY_COUNT
    ),
    retryBaseDelayMs: parsePositiveMs(
      process.env.IMAP_CONNECT_RETRY_BASE_DELAY_MS,
      DEFAULT_IMAP_CONNECT_RETRY_BASE_DELAY_MS
    ),
    retryMaxDelayMs: parsePositiveMs(
      process.env.IMAP_CONNECT_RETRY_MAX_DELAY_MS,
      DEFAULT_IMAP_CONNECT_RETRY_MAX_DELAY_MS
    ),
    breakerThreshold: parseRetryCount(
      process.env.IMAP_CONNECT_BREAKER_THRESHOLD,
      DEFAULT_IMAP_CONNECT_BREAKER_THRESHOLD
    ),
    breakerCooldownMs: parsePositiveMs(
      process.env.IMAP_CONNECT_BREAKER_COOLDOWN_MS,
      DEFAULT_IMAP_CONNECT_BREAKER_COOLDOWN_MS
    )
  };
}

function buildImapCircuitKey(account: Account) {
  return `${account.id}:${account.imap.host}:${account.imap.port}:${account.imap.secure ? "secure" : "starttls"}`;
}

function isRetryableImapConnectError(error: unknown) {
  const message = ((error as Error | undefined)?.message ?? String(error ?? "")).toLowerCase();
  if (!message) return false;
  if (
    [
      "invalid imap credentials",
      "authentication failed",
      "no password configured",
      "account not found",
      "missing accountid"
    ].some((pattern) => message.includes(pattern))
  ) {
    return false;
  }
  return [
    "peer certificate missing",
    "peer certificate is empty",
    "certificate has no san and no cn",
    "connect_timeout",
    "greeting_timeout",
    "failed to establish connection in required time",
    "failed to receive greeting from server in required time",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "network is unreachable",
    "connection closed",
    "closedafterconnect"
  ].some((pattern) => message.includes(pattern));
}

function getImapConnectDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number) {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), maxDelayMs);
}

function getImapConnectBreakerState(account: Account) {
  const key = buildImapCircuitKey(account);
  const state = imapConnectCircuitState.get(key) ?? null;
  return { key, state };
}

function clearImapConnectFailureState(account: Account) {
  const { key } = getImapConnectBreakerState(account);
  imapConnectCircuitState.delete(key);
}

export function resetImapConnectFailureState(account?: Account) {
  if (account) {
    clearImapConnectFailureState(account);
    return;
  }
  imapConnectCircuitState.clear();
}

function recordImapConnectFailure(account: Account, error: unknown) {
  const { key, state } = getImapConnectBreakerState(account);
  const options = getImapConnectRetryOptions();
  const nextState: ImapConnectCircuitState = {
    consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1,
    openedUntil:
      (state?.consecutiveFailures ?? 0) + 1 >= Math.max(1, options.breakerThreshold)
        ? Date.now() + options.breakerCooldownMs
        : 0,
    lastError: (error as Error | undefined)?.message ?? String(error ?? "")
  };
  imapConnectCircuitState.set(key, nextState);
  return nextState;
}

function getImapBreakerFastFailError(account: Account, state: ImapConnectCircuitState) {
  const remainingMs = Math.max(0, state.openedUntil - Date.now());
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return new Error(
    `IMAP connection temporarily unavailable for ${account.imap.host}; retry in ${seconds}s${state.lastError ? ` (last error: ${state.lastError})` : ""}`
  );
}

export async function connectImapClientWithRetry(params: {
  account: Account;
  createClient: () => ImapFlow;
  logContext?: ImapClientLogContext;
  connectOp?: string;
}) {
  const { account, createClient, logContext = {}, connectOp = "connect" } = params;
  const logger = getImapLogger();
  const retryOptions = getImapConnectRetryOptions();
  const breakerState = getImapConnectBreakerState(account).state;
  if (breakerState && breakerState.openedUntil > Date.now()) {
    const error = getImapBreakerFastFailError(account, breakerState);
    if (logger !== false) {
      logger.warn?.({
        event: "imap.connect_fast_fail",
        accountId: logContext.accountId ?? account.id,
        clientId: logContext.clientId ?? null,
        mailbox: logContext.mailbox ?? null,
        host: account.imap.host,
        openedUntil: breakerState.openedUntil,
        consecutiveFailures: breakerState.consecutiveFailures,
        error: error.message
      });
    }
    throw error;
  }

  const maxAttempts = Math.max(1, retryOptions.retryCount + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = createClient();
    try {
      await logImapOp(connectOp, { host: account.imap.host, ...logContext }, () => client.connect());
      if (attempt > 1 && logger !== false) {
        logger.info?.({
          event: "imap.connect_recovered",
          accountId: logContext.accountId ?? account.id,
          clientId: logContext.clientId ?? null,
          mailbox: logContext.mailbox ?? null,
          host: account.imap.host,
          attempt,
          maxAttempts
        });
      }
      clearImapConnectFailureState(account);
      return client;
    } catch (error) {
      lastError = error;
      try {
        await client.logout();
      } catch {
        // ignore cleanup failures on failed connect attempts
      }
      const retryable = isRetryableImapConnectError(error);
      const isLastAttempt = attempt === maxAttempts;

      if (!retryable || isLastAttempt) {
        const nextState = recordImapConnectFailure(account, error);
        if (logger !== false && nextState.openedUntil > Date.now()) {
          logger.warn?.({
            event: "imap.connect_breaker_open",
            accountId: logContext.accountId ?? account.id,
            clientId: logContext.clientId ?? null,
            mailbox: logContext.mailbox ?? null,
            host: account.imap.host,
            consecutiveFailures: nextState.consecutiveFailures,
            openedUntil: nextState.openedUntil,
            error: (error as Error | undefined)?.message ?? String(error ?? "")
          });
        }
        throw error;
      }

      const delayMs = getImapConnectDelayMs(
        attempt,
        retryOptions.retryBaseDelayMs,
        retryOptions.retryMaxDelayMs
      );
      if (logger !== false) {
        logger.warn?.({
          event: "imap.connect_retry",
          accountId: logContext.accountId ?? account.id,
          clientId: logContext.clientId ?? null,
          mailbox: logContext.mailbox ?? null,
          host: account.imap.host,
          attempt,
          maxAttempts,
          delayMs,
          error: (error as Error | undefined)?.message ?? String(error ?? "")
        });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("IMAP connection failed.");
}

export async function safeLogoutImapClient(
  client: Pick<ImapFlow, "logout"> | null | undefined,
  details: Record<string, unknown>,
  op = "logout"
) {
  if (!client) return;
  try {
    await logImapOp(op, details, () => client.logout());
  } catch {
    // ignore logout errors
  }
}

export function buildImapFlowOptions(
  account: Account,
  overrides: Partial<ImapFlowOptions> = {},
  logContext: ImapClientLogContext = {}
): ImapFlowOptions {
  const baseAuth = {
    user: account.imap.user,
    pass: account.imap.password
  };
  const baseTls: NonNullable<ImapFlowOptions["tls"]> = {
    servername: account.imap.host,
    checkServerIdentity: (hostname, cert) => {
      const logTlsIdentityFailure = (reason: TlsIdentityCheckFailureReason, error: Error) => {
        const logger = getImapLogger();
        if (logger === false) return;
        logger.warn?.({
          event: "tls.identity_check_failed",
          reason,
          hostname,
          accountId: logContext.accountId ?? null,
          clientId: logContext.clientId ?? null,
          mailbox: logContext.mailbox ?? null,
          hasPeerCertificate: cert !== undefined,
          hasPeerCertificateData: hasTlsPeerCertificateData(cert),
          certificate: summarizeTlsPeerCertificate(cert),
          error: error.message
        });
      };
      // Some IMAP servers (e.g. certain IONOS backends) intermittently present
      // CN-only certs with no Subject Alternative Names during TLS handshakes.
      // Node 17+ / Bun dropped the CN fallback, so tls.checkServerIdentity
      // throws "Cert does not contain a DNS name". Re-implement the CN fallback
      // for these legacy certs.
      if (!cert) {
        const error = new Error(`Peer certificate missing for hostname "${hostname}"`);
        logTlsIdentityFailure("missing-peer-certificate", error);
        return error;
      }
      if (!hasTlsPeerCertificateData(cert)) {
        const error = new Error(`Peer certificate is empty for hostname "${hostname}"`);
        logTlsIdentityFailure("empty-peer-certificate", error);
        return error;
      }
      if (!cert?.subjectaltname) {
        const cn = (cert as { subject?: { CN?: string } } | undefined)?.subject?.CN;
        if (!cn) {
          const error = new Error(
            `Certificate has no SAN and no CN — cannot verify hostname "${hostname}"`
          );
          logTlsIdentityFailure("missing-san-and-cn", error);
          return error;
        }
        // RFC 4343: DNS names are case-insensitive.
        const cnLower = cn.toLowerCase();
        const hostLower = hostname.toLowerCase();
        if (cnLower === hostLower) return undefined;
        // RFC 6125 §6.4.3: wildcard certs match only a single left-most label.
        if (
          cnLower.startsWith("*.") &&
          hostLower.endsWith(cnLower.slice(1)) &&
          !hostLower.slice(0, -cnLower.slice(1).length).includes(".")
        ) {
          return undefined;
        }
        const error = new Error(`Hostname "${hostname}" does not match certificate CN "${cn}"`);
        logTlsIdentityFailure("cn-mismatch", error);
        return error;
      }
      const error = tls.checkServerIdentity(hostname, cert);
      if (error) {
        logTlsIdentityFailure("tls-check-failed", error);
      }
      return error;
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

function summarizeTlsPeerCertificate(cert: tls.PeerCertificate | undefined) {
  const subject = cert?.subject && typeof cert.subject === "object" ? cert.subject : null;
  const issuer = cert?.issuer && typeof cert.issuer === "object" ? cert.issuer : null;

  return {
    subject,
    issuer,
    subjectAltName: typeof cert?.subjectaltname === "string" ? cert.subjectaltname : null,
    serialNumber: typeof cert?.serialNumber === "string" ? cert.serialNumber : null,
    fingerprint: typeof cert?.fingerprint === "string" ? cert.fingerprint : null,
    fingerprint256: typeof cert?.fingerprint256 === "string" ? cert.fingerprint256 : null,
    validFrom: typeof cert?.valid_from === "string" ? cert.valid_from : null,
    validTo: typeof cert?.valid_to === "string" ? cert.valid_to : null
  };
}

function hasObjectValues(value: Record<string, unknown> | null) {
  return Boolean(value && Object.keys(value).length > 0);
}

function hasTlsPeerCertificateData(cert: tls.PeerCertificate | undefined) {
  if (!cert) return false;
  const summary = summarizeTlsPeerCertificate(cert);
  return Boolean(
    hasObjectValues(summary.subject) ||
      hasObjectValues(summary.issuer) ||
      summary.subjectAltName ||
      summary.serialNumber ||
      summary.fingerprint ||
      summary.fingerprint256 ||
      summary.validFrom ||
      summary.validTo
  );
}

function summarizeTlsSocket(client: ImapFlow) {
  const socket = (client as ImapFlow & {
    socket?: tls.TLSSocket & {
      remoteAddress?: string;
      remotePort?: number;
      localAddress?: string;
      localPort?: number;
      authorizationError?: Error | string | null;
    };
    secureConnection?: boolean;
  }).socket;

  if (!socket) {
    return {
      present: false,
      secureConnection: Boolean((client as ImapFlow & { secureConnection?: boolean }).secureConnection)
    };
  }

  let peerCertificate: tls.PeerCertificate | undefined;
  try {
    peerCertificate =
      typeof socket.getPeerCertificate === "function"
        ? (socket.getPeerCertificate(true) as tls.PeerCertificate | undefined)
        : undefined;
  } catch {
    peerCertificate = undefined;
  }

  let cipher:
    | {
        name?: string;
        standardName?: string;
        version?: string;
      }
    | null = null;
  try {
    cipher =
      typeof socket.getCipher === "function"
        ? (socket.getCipher() as { name?: string; standardName?: string; version?: string } | null)
        : null;
  } catch {
    cipher = null;
  }

  let protocol: string | null = null;
  try {
    protocol = typeof socket.getProtocol === "function" ? socket.getProtocol() ?? null : null;
  } catch {
    protocol = null;
  }

  return {
    present: true,
    ...summarizeSpecificTlsSocket(
      socket,
      Boolean((client as ImapFlow & { secureConnection?: boolean }).secureConnection),
      peerCertificate,
      cipher,
      protocol
    )
  };
}

function summarizeSpecificTlsSocket(
  socket: tls.TLSSocket & {
    remoteAddress?: string;
    remotePort?: number;
    localAddress?: string;
    localPort?: number;
    authorizationError?: Error | string | null;
  },
  secureConnection: boolean,
  peerCertificate?: tls.PeerCertificate,
  cipher?: { name?: string; standardName?: string; version?: string } | null,
  protocol?: string | null
) {
  const resolvedPeerCertificate =
    peerCertificate ??
    (() => {
      try {
        return typeof socket.getPeerCertificate === "function"
          ? (socket.getPeerCertificate(true) as tls.PeerCertificate | undefined)
          : undefined;
      } catch {
        return undefined;
      }
    })();
  const resolvedCipher =
    cipher ??
    (() => {
      try {
        return typeof socket.getCipher === "function"
          ? (socket.getCipher() as { name?: string; standardName?: string; version?: string } | null)
          : null;
      } catch {
        return null;
      }
    })();
  const resolvedProtocol =
    protocol ??
    (() => {
      try {
        return typeof socket.getProtocol === "function" ? socket.getProtocol() ?? null : null;
      } catch {
        return null;
      }
    })();

  return {
    secureConnection,
    authorized: typeof socket.authorized === "boolean" ? socket.authorized : null,
    authorizationError:
      socket.authorizationError instanceof Error
        ? socket.authorizationError.message
        : typeof socket.authorizationError === "string"
          ? socket.authorizationError
          : null,
    remoteAddress: socket.remoteAddress ?? null,
    remotePort: typeof socket.remotePort === "number" ? socket.remotePort : null,
    localAddress: socket.localAddress ?? null,
    localPort: typeof socket.localPort === "number" ? socket.localPort : null,
    alpnProtocol: typeof socket.alpnProtocol === "string" ? socket.alpnProtocol : null,
    cipher: resolvedCipher,
    protocol: resolvedProtocol,
    peerCertificate: summarizeTlsPeerCertificate(resolvedPeerCertificate),
    hasPeerCertificateData: hasTlsPeerCertificateData(resolvedPeerCertificate)
  };
}

function bindImapSocketDiagnostics(client: ImapFlow, context: ImapClientLogContext = {}) {
  const logger = getImapLogger();
  if (logger === false) return;

  const instrumentedClient = client as ImapFlow & {
    connect: ImapFlow["connect"];
    socket?: tls.TLSSocket & {
      remoteAddress?: string;
      remotePort?: number;
      localAddress?: string;
      localPort?: number;
      authorizationError?: Error | string | null;
      [SOCKET_DIAGNOSTICS_BOUND]?: boolean;
    };
    secureConnection?: boolean;
    [CONNECT_DIAGNOSTICS_BOUND]?: boolean;
  };

  if (instrumentedClient[CONNECT_DIAGNOSTICS_BOUND]) return;
  if (typeof instrumentedClient.connect !== "function") return;
  instrumentedClient[CONNECT_DIAGNOSTICS_BOUND] = true;

  const originalConnect = instrumentedClient.connect.bind(client) as ImapFlow["connect"];
  instrumentedClient.connect = async () => {
    const connectPromise = originalConnect();
    const socket = instrumentedClient.socket;
    if (socket && !socket[SOCKET_DIAGNOSTICS_BOUND]) {
      socket[SOCKET_DIAGNOSTICS_BOUND] = true;
      socket.once("connect", () => {
        logger.info?.({
          event: "imap.socket_connect",
          accountId: context.accountId ?? null,
          clientId: context.clientId ?? null,
          mailbox: context.mailbox ?? null,
          socket: summarizeSpecificTlsSocket(
            socket,
            Boolean(instrumentedClient.secureConnection)
          )
        });
      });
      socket.once("secureConnect", () => {
        logger.info?.({
          event: "imap.socket_secure_connect",
          accountId: context.accountId ?? null,
          clientId: context.clientId ?? null,
          mailbox: context.mailbox ?? null,
          socket: summarizeSpecificTlsSocket(
            socket,
            Boolean(instrumentedClient.secureConnection)
          )
        });
      });
      socket.on("tlsClientError", (error) => {
        logger.warn?.({
          event: "imap.socket_tls_client_error",
          accountId: context.accountId ?? null,
          clientId: context.clientId ?? null,
          mailbox: context.mailbox ?? null,
          error: (error as Error)?.message ?? String(error),
          socket: summarizeSpecificTlsSocket(
            socket,
            Boolean(instrumentedClient.secureConnection)
          )
        });
      });
      socket.on("error", (error) => {
        logger.warn?.({
          event: "imap.socket_error",
          accountId: context.accountId ?? null,
          clientId: context.clientId ?? null,
          mailbox: context.mailbox ?? null,
          error: (error as Error)?.message ?? String(error),
          socket: summarizeSpecificTlsSocket(
            socket,
            Boolean(instrumentedClient.secureConnection)
          )
        });
      });
      socket.once("close", (hadError) => {
        logger.info?.({
          event: "imap.socket_close",
          accountId: context.accountId ?? null,
          clientId: context.clientId ?? null,
          mailbox: context.mailbox ?? null,
          hadError,
          socket: summarizeSpecificTlsSocket(
            socket,
            Boolean(instrumentedClient.secureConnection)
          )
        });
      });
    }
    return await connectPromise;
  };
}

export function bindImapClientError(client: ImapFlow, context: ImapClientLogContext = {}) {
  const logger = getImapLogger();
  bindImapSocketDiagnostics(client, context);
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
    logger.warn?.({
      event: "imap.client_error_diagnostics",
      accountId: context.accountId ?? null,
      clientId: context.clientId ?? null,
      mailbox: context.mailbox ?? null,
      error: (error as Error)?.message ?? String(error),
      socket: summarizeTlsSocket(client)
    });
    logger.warn?.(
      `[imap] client.error${suffix} error=${(error as Error)?.message ?? String(error)}`
    );
  });
}
