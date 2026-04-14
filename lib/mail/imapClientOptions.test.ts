import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "events";

import type { Account } from "@/lib/data";

import {
  bindImapClientError,
  buildImapFlowOptions,
  connectImapClientWithRetry,
  resetImapConnectFailureState
} from "./imapClientOptions";

const account = {
  id: "acc-test",
  imap: {
    host: "imap.example.test",
    port: 993,
    secure: true,
    user: "user@example.test",
    password: "password"
  }
} as Account;

describe("buildImapFlowOptions TLS identity logging", () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalLogLevel = process.env.IMAP_LOG_LEVEL;
  const originalRetryCount = process.env.IMAP_CONNECT_RETRY_COUNT;
  const originalRetryBaseDelay = process.env.IMAP_CONNECT_RETRY_BASE_DELAY_MS;
  const originalBreakerThreshold = process.env.IMAP_CONNECT_BREAKER_THRESHOLD;
  const originalBreakerCooldown = process.env.IMAP_CONNECT_BREAKER_COOLDOWN_MS;
  let infos: string[] = [];
  let warnings: string[] = [];

  beforeEach(() => {
    infos = [];
    warnings = [];
    resetImapConnectFailureState();
    process.env.IMAP_LOG_LEVEL = "warn";
    console.log = (...args: unknown[]) => {
      infos.push(args.map((item) => String(item)).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((item) => String(item)).join(" "));
    };
  });

  afterEach(() => {
    resetImapConnectFailureState();
    console.log = originalLog;
    console.warn = originalWarn;
    if (typeof originalLogLevel === "string") {
      process.env.IMAP_LOG_LEVEL = originalLogLevel;
    } else {
      delete process.env.IMAP_LOG_LEVEL;
    }
    if (typeof originalRetryCount === "string") {
      process.env.IMAP_CONNECT_RETRY_COUNT = originalRetryCount;
    } else {
      delete process.env.IMAP_CONNECT_RETRY_COUNT;
    }
    if (typeof originalRetryBaseDelay === "string") {
      process.env.IMAP_CONNECT_RETRY_BASE_DELAY_MS = originalRetryBaseDelay;
    } else {
      delete process.env.IMAP_CONNECT_RETRY_BASE_DELAY_MS;
    }
    if (typeof originalBreakerThreshold === "string") {
      process.env.IMAP_CONNECT_BREAKER_THRESHOLD = originalBreakerThreshold;
    } else {
      delete process.env.IMAP_CONNECT_BREAKER_THRESHOLD;
    }
    if (typeof originalBreakerCooldown === "string") {
      process.env.IMAP_CONNECT_BREAKER_COOLDOWN_MS = originalBreakerCooldown;
    } else {
      delete process.env.IMAP_CONNECT_BREAKER_COOLDOWN_MS;
    }
  });

  it("logs an empty peer certificate separately from missing SAN/CN", () => {
    const options = buildImapFlowOptions(account, {}, {
      accountId: account.id,
      clientId: "client-123",
      mailbox: "INBOX"
    });

    const error = options.tls?.checkServerIdentity?.("imap.example.test", {
      subject: {},
      issuer: undefined
    });

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("Peer certificate is empty");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"event":"tls.identity_check_failed"');
    expect(warnings[0]).toContain('"reason":"empty-peer-certificate"');
    expect(warnings[0]).toContain('"accountId":"acc-test"');
    expect(warnings[0]).toContain('"clientId":"client-123"');
    expect(warnings[0]).toContain('"mailbox":"INBOX"');
    expect(warnings[0]).toContain('"hasPeerCertificateData":false');
  });

  it("logs certificate details when names are missing on a populated peer certificate", () => {
    const options = buildImapFlowOptions(account, {}, {
      accountId: account.id
    });

    const error = options.tls?.checkServerIdentity?.("imap.example.test", {
      subject: { O: "Legacy Mail" },
      issuer: { CN: "Legacy Issuer" },
      serialNumber: "02"
    });

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("Certificate has no SAN and no CN");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"reason":"missing-san-and-cn"');
    expect(warnings[0]).toContain('"hasPeerCertificateData":true');
  });

  it("logs SAN verification failures from tls.checkServerIdentity", () => {
    const options = buildImapFlowOptions(account, {}, {
      accountId: account.id
    });

    const error = options.tls?.checkServerIdentity?.("imap.example.test", {
      subject: { CN: "unrelated.example.test" },
      subjectaltname: "DNS:unrelated.example.test",
      issuer: { CN: "Example Issuer" }
    });

    expect(error).toBeInstanceOf(Error);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"reason":"tls-check-failed"');
    expect(warnings[0]).toContain('"subjectAltName":"DNS:unrelated.example.test"');
  });

  it("logs socket diagnostics with client errors", () => {
    const client = new EventEmitter() as EventEmitter & {
      socket?: {
        authorized: boolean;
        authorizationError?: string;
        remoteAddress?: string;
        remotePort?: number;
        localAddress?: string;
        localPort?: number;
        alpnProtocol?: string;
        getPeerCertificate?: (detailed?: boolean) => unknown;
        getCipher?: () => unknown;
        getProtocol?: () => string;
      };
      secureConnection?: boolean;
    };

    client.secureConnection = true;
    client.socket = {
      authorized: false,
      authorizationError: "Hostname/IP does not match certificate's altnames",
      remoteAddress: "212.227.24.204",
      remotePort: 993,
      localAddress: "192.0.2.10",
      localPort: 54321,
      alpnProtocol: "",
      getPeerCertificate: () => ({
        subject: { CN: "legacy.example.test" },
        issuer: { CN: "Legacy Issuer" },
        fingerprint256: "AA:BB:CC"
      }),
      getCipher: () => ({
        name: "TLS_AES_256_GCM_SHA384",
        standardName: "TLS_AES_256_GCM_SHA384",
        version: "TLSv1.3"
      }),
      getProtocol: () => "TLSv1.3"
    };

    bindImapClientError(client as never, {
      accountId: account.id,
      clientId: "client-123",
      mailbox: "INBOX"
    });
    client.emit("error", new Error("connect failed"));

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"event":"imap.client_error_diagnostics"');
    expect(warnings[0]).toContain('"authorized":false');
    expect(warnings[0]).toContain('"authorizationError":"Hostname/IP does not match certificate\'s altnames"');
    expect(warnings[0]).toContain('"remoteAddress":"212.227.24.204"');
    expect(warnings[0]).toContain('"fingerprint256":"AA:BB:CC"');
    expect(warnings[1]).toContain("[imap] client.error mailbox=INBOX account=acc-test client=client-123 error=connect failed");
  });

  it("logs socket connect diagnostics from the shared client binding", async () => {
    process.env.IMAP_LOG_LEVEL = "info";

    class FakeSocket extends EventEmitter {
      authorized = false;
      authorizationError = "certificate verify failed";
      remoteAddress = "212.227.24.208";
      remotePort = 993;
      localAddress = "192.0.2.44";
      localPort = 55443;
      alpnProtocol = "";

      getPeerCertificate() {
        return {
          subject: { CN: "imap.ionos.de" },
          issuer: { CN: "Example Issuer" },
          fingerprint256: "AA:BB:CC"
        };
      }

      getCipher() {
        return {
          name: "TLS_AES_256_GCM_SHA384",
          standardName: "TLS_AES_256_GCM_SHA384",
          version: "TLSv1.3"
        };
      }

      getProtocol() {
        return "TLSv1.3";
      }
    }

    class FakeClient extends EventEmitter {
      socket?: FakeSocket;
      secureConnection = true;

      async connect() {
        this.socket = new FakeSocket();
      }
    }

    const client = new FakeClient();
    bindImapClientError(client as never, {
      accountId: account.id,
      clientId: "client-123"
    });

    await client.connect();
    client.socket?.emit("connect");
    client.socket?.emit("error", new Error("socket failed"));

    expect(infos).toHaveLength(1);
    expect(infos[0]).toContain('"event":"imap.socket_connect"');
    expect(infos[0]).toContain('"remoteAddress":"212.227.24.208"');
    expect(infos[0]).toContain('"fingerprint256":"AA:BB:CC"');
    expect(warnings[0]).toContain('"event":"imap.socket_error"');
    expect(warnings[0]).toContain('"error":"socket failed"');
  });

  it("retries connect with a fresh client and logs recovery", async () => {
    process.env.IMAP_LOG_LEVEL = "info";
    process.env.IMAP_CONNECT_RETRY_COUNT = "1";
    process.env.IMAP_CONNECT_RETRY_BASE_DELAY_MS = "1";
    process.env.IMAP_CONNECT_BREAKER_THRESHOLD = "9";

    let createdClients = 0;
    let connectCalls = 0;
    const retryAccount = {
      ...account,
      id: "acc-retry"
    } as Account;

    const client = await connectImapClientWithRetry({
      account: retryAccount,
      logContext: { accountId: retryAccount.id, mailbox: "INBOX" },
      createClient: () => {
        createdClients += 1;
        const nextClient = new EventEmitter() as EventEmitter & {
          connect: () => Promise<void>;
          logout: () => Promise<void>;
        };
        nextClient.connect = async () => {
          connectCalls += 1;
          if (connectCalls === 1) {
            throw new Error('Peer certificate missing for hostname "imap.example.test"');
          }
        };
        nextClient.logout = async () => {};
        return nextClient as never;
      }
    });

    expect(client).toBeTruthy();
    expect(createdClients).toBe(2);
    expect(connectCalls).toBe(2);
    expect(warnings.some((line) => line.includes('"event":"imap.connect_retry"'))).toBe(true);
    expect(infos.some((line) => line.includes('"event":"imap.connect_recovered"'))).toBe(true);
  });

  it("fast-fails after the breaker opens for repeated connect failures", async () => {
    process.env.IMAP_LOG_LEVEL = "warn";
    process.env.IMAP_CONNECT_RETRY_COUNT = "0";
    process.env.IMAP_CONNECT_BREAKER_THRESHOLD = "1";
    process.env.IMAP_CONNECT_BREAKER_COOLDOWN_MS = "50";

    const breakerAccount = {
      ...account,
      id: "acc-breaker"
    } as Account;

    await expect(
      connectImapClientWithRetry({
        account: breakerAccount,
        createClient: () => {
          const nextClient = new EventEmitter() as EventEmitter & {
            connect: () => Promise<void>;
            logout: () => Promise<void>;
          };
          nextClient.connect = async () => {
            throw new Error('Peer certificate missing for hostname "imap.example.test"');
          };
          nextClient.logout = async () => {};
          return nextClient as never;
        }
      })
    ).rejects.toThrow('Peer certificate missing for hostname "imap.example.test"');

    await expect(
      connectImapClientWithRetry({
        account: breakerAccount,
        createClient: () => {
          const nextClient = new EventEmitter() as EventEmitter & {
            connect: () => Promise<void>;
            logout: () => Promise<void>;
          };
          nextClient.connect = async () => {};
          nextClient.logout = async () => {};
          return nextClient as never;
        }
      })
    ).rejects.toThrow("IMAP connection temporarily unavailable");

    expect(warnings.some((line) => line.includes('"event":"imap.connect_breaker_open"'))).toBe(true);
    expect(warnings.some((line) => line.includes('"event":"imap.connect_fast_fail"'))).toBe(true);
  });
});
