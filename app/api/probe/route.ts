import { NextResponse } from "next/server";
import net from "net";
import tls from "tls";
import { createRateLimiter, getRequestIp } from "@/lib/rateLimit";

/**
 * POST /api/probe — tests whether a user-supplied IMAP/SMTP host:port
 * supports implicit TLS and/or STARTTLS. Invoked from the "Test connection"
 * button in `AccountSettingsModal.tsx` during account setup. Rate-limited
 * per-IP because it does arbitrary outbound TCP to user-supplied hosts.
 */

const TIMEOUT_MS = 3500;

const probeLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

async function probeImplicitTLS(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    let finished = false;
    const done = (result: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(result);
    };
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false
      },
      () => done(true)
    );
    socket.setTimeout(TIMEOUT_MS, () => done(false));
    socket.on("error", () => done(false));
    socket.on("end", () => done(finished ? finished : false));
  });
}

async function probeImapStartTLS(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    let finished = false;
    const done = (result: boolean) => {
      if (finished) return;
      finished = true;
      socket.end();
      resolve(result);
    };
    const socket = net.connect({ host, port }, () => {
      socket.write("a1 CAPABILITY\r\n");
    });
    socket.setTimeout(TIMEOUT_MS);
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (data.includes("CAPABILITY")) {
        done(data.toUpperCase().includes("STARTTLS"));
      }
    });
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
    socket.on("end", () => done(finished ? finished : false));
  });
}

async function probeSmtpStartTLS(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    let finished = false;
    const done = (result: boolean) => {
      if (finished) return;
      finished = true;
      socket.end();
      resolve(result);
    };
    const socket = net.connect({ host, port }, () => {
      socket.write("EHLO noctua.local\r\n");
    });
    socket.setTimeout(TIMEOUT_MS);
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (data.includes("\r\n")) {
        if (data.toUpperCase().includes("STARTTLS")) {
          done(true);
        }
        if (data.includes("\r\n.")) {
          done(false);
        }
      }
    });
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
    socket.on("end", () => done(finished ? finished : false));
  });
}

export async function POST(request: Request) {
  const ip = getRequestIp(request);

  if (probeLimiter.isLimited(ip)) {
    return NextResponse.json(
      { ok: false, message: "Too many requests — try again later" },
      { status: 429 }
    );
  }

  const payload = (await request.json()) as {
    protocol: "imap" | "smtp";
    host: string;
    port: number;
  };

  if (!payload.host || !payload.port) {
    return NextResponse.json({ ok: false, message: "Host and port required" }, { status: 400 });
  }

  const supportsTLS = await probeImplicitTLS(payload.host, payload.port);
  const supportsStartTLS = payload.protocol === "imap"
    ? await probeImapStartTLS(payload.host, payload.port)
    : await probeSmtpStartTLS(payload.host, payload.port);

  return NextResponse.json({ ok: true, supportsTLS, supportsStartTLS });
}
