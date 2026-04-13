import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "events";

import type { Account } from "@/lib/data";

import { bindImapClientError, buildImapFlowOptions } from "./imapClientOptions";

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
  let infos: string[] = [];
  let warnings: string[] = [];

  beforeEach(() => {
    infos = [];
    warnings = [];
    process.env.IMAP_LOG_LEVEL = "warn";
    console.log = (...args: unknown[]) => {
      infos.push(args.map((item) => String(item)).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((item) => String(item)).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    if (typeof originalLogLevel === "string") {
      process.env.IMAP_LOG_LEVEL = originalLogLevel;
      return;
    }
    delete process.env.IMAP_LOG_LEVEL;
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
});
