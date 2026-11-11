import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import net from "net";

import type { Account } from "@/lib/data";

import { verifyImapCredentials } from "./imapAuth";

// A real socket instead of a stubbed client: the classification depends on the
// error shapes imapflow derives from the server's reply.
async function startImapServer(loginReply: string) {
  let logins = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.write("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] ready\r\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
        const [tag, command = ""] = buffer.slice(0, end).split(" ");
        buffer = buffer.slice(end + 2);
        switch (command.toUpperCase()) {
          case "CAPABILITY":
            socket.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n${tag} OK done\r\n`);
            break;
          case "AUTHENTICATE":
            logins += 1;
            socket.write(`${tag} ${loginReply}\r\n`);
            break;
          case "NAMESPACE":
            socket.write(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK done\r\n`);
            break;
          case "LOGOUT":
            socket.end(`* BYE\r\n${tag} OK done\r\n`);
            break;
          default:
            socket.write(`${tag} BAD unknown command\r\n`);
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    logins: () => logins,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  };
}

function accountFor(port: number, id: string) {
  return {
    id,
    email: "user@example.test",
    imap: { host: "127.0.0.1", port, secure: false, user: "user@example.test", password: "" }
  } as Account;
}

describe("verifyImapCredentials", () => {
  const envKeys = [
    "IMAP_LOG_LEVEL",
    "IMAP_CONNECT_RETRY_COUNT",
    "IMAP_CONNECT_RETRY_BASE_DELAY_MS"
  ] as const;
  const originalEnv = new Map<string, string | undefined>();
  let server: Awaited<ReturnType<typeof startImapServer>> | null = null;

  beforeEach(() => {
    for (const key of envKeys) originalEnv.set(key, process.env[key]);
    process.env.IMAP_LOG_LEVEL = "silent";
    process.env.IMAP_CONNECT_RETRY_COUNT = "1";
    process.env.IMAP_CONNECT_RETRY_BASE_DELAY_MS = "1";
  });

  afterEach(() => {
    server?.close();
    server = null;
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("accepts credentials the server accepts", async () => {
    server = await startImapServer("OK done");
    expect(await verifyImapCredentials(accountFor(server.port, "acc-verify-ok"), "secret")).toBe(
      "ok"
    );
  });

  it("reports credentials the server rejects as invalid, without retrying", async () => {
    server = await startImapServer("NO [AUTHENTICATIONFAILED] Authentication failed.");
    expect(
      await verifyImapCredentials(accountFor(server.port, "acc-verify-invalid"), "secret")
    ).toBe("invalid");
    expect(server.logins()).toBe(1);
  });

  it("reports a login the server could not process as unreachable, after retrying", async () => {
    server = await startImapServer("NO [UNAVAILABLE] Temporary authentication failure.");
    expect(
      await verifyImapCredentials(accountFor(server.port, "acc-verify-unavailable"), "secret")
    ).toBe("unreachable");
    expect(server.logins()).toBe(2);
  });

  it("reports a server that refuses connections as unreachable", async () => {
    const closed = await startImapServer("OK done");
    closed.close();
    expect(
      await verifyImapCredentials(accountFor(closed.port, "acc-verify-refused"), "secret")
    ).toBe("unreachable");
  });
});
