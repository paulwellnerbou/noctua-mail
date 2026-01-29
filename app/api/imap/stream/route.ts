import { NextResponse } from "next/server";
import tls from "tls";

import { getAccounts, getFolders, getMailboxState, saveMailboxState } from "@/lib/db";
import { getImapLogger, logImapOp } from "@/lib/mail/imapLogger";
import { registerStream } from "@/lib/mail/imapStreamRegistry";
import { requireSessionOr401 } from "@/lib/auth";

type EnvelopeAddress = { name?: string | null; mailbox?: string | null; host?: string | null };
type Envelope = { subject?: string | null; from?: EnvelopeAddress[] | null; date?: Date | null; messageId?: string | null };

const DEFAULT_MAX_IDLE = 3;
const DEFAULT_POLL_INTERVAL = 300_000; // 5 minutes

function formatAddress(addresses?: EnvelopeAddress[] | null) {
  if (!addresses || addresses.length === 0) return "";
  const parts = addresses.map((addr) => {
    const email = addr?.mailbox && addr?.host ? `${addr.mailbox}@${addr.host}` : "";
    if (addr?.name && email) return `"${addr.name}" <${email}>`;
    return addr?.name || email || "";
  });
  return parts.filter(Boolean).join(", ");
}

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const activeFolderId = searchParams.get("activeFolderId");
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }

  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const logContext = { accountId, clientId };

  const maxIdleSessions =
    Number(searchParams.get("maxIdleSessions")) ||
    account?.settings?.sync?.maxIdleSessions ||
    DEFAULT_MAX_IDLE;
  const pollIntervalMs =
    Number(searchParams.get("pollIntervalMs")) ||
    account?.settings?.sync?.pollIntervalMs ||
    DEFAULT_POLL_INTERVAL;

  const folders = await getFolders(accountId);
  const inboxFolder =
    folders.find((f) => (f.specialUse ?? "").toLowerCase() === "\\inbox") ||
    folders.find((f) => f.name.toLowerCase() === "inbox") ||
    folders[0];

  const encoder = new TextEncoder();

  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch {
    return NextResponse.json(
      { ok: false, message: "IMAP library is missing. Run `bun install`." },
      { status: 500 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      type Session = {
        mailbox: string;
        folderId: string;
        client: import("imapflow").ImapFlow;
        lastUidNext: number;
        lastUsed: number;
        inbox: boolean;
      };

      const sessions = new Map<string, Session>(); // key: folderId
      const removedFolderIds = new Set<string>();
      const unregister = registerStream(accountId, {
        removeFolder: async (folderId: string) => {
          removedFolderIds.add(folderId);
          await closeSession(folderId);
        }
      });

      const stopAll = async () => {
        for (const item of sessions.values()) {
          try {
            await logImapOp(
              "imap.logout",
              { ...logContext, mailbox: item.mailbox },
              async () => {
                await item.client.logout();
              }
            );
          } catch {
            // ignore
          }
        }
        controller.close();
        unregister();
      };

      request.signal.addEventListener("abort", () => {
        void stopAll();
      });

      const closeSession = async (folderId: string) => {
        const sess = sessions.get(folderId);
        if (!sess) return;
        sessions.delete(folderId);
        try {
          await logImapOp("imap.logout", { ...logContext, mailbox: sess.mailbox }, async () => {
            await sess.client.logout();
          });
        } catch {
          // ignore
        }
      };

      const enforceCapacity = async () => {
        if (sessions.size <= maxIdleSessions) return;
        // pick least recently used that is not inbox and not the current active folder
        let oldest: Session | null = null;
        for (const sess of sessions.values()) {
          if (sess.inbox) continue;
          if (activeFolderId && sess.folderId === activeFolderId) continue;
          if (!oldest || sess.lastUsed < oldest.lastUsed) {
            oldest = sess;
          }
        }
        if (oldest) {
          await closeSession(oldest.folderId);
        }
      };

      const openWatcher = async (folderId: string | undefined | null, markUsed = true) => {
        if (!folderId) return;
        if (removedFolderIds.has(folderId)) return;
        const folder = folders.find((f) => f.id === folderId);
        if (!folder) return;
        if (sessions.has(folder.id)) {
          const existing = sessions.get(folder.id)!;
          if (markUsed) existing.lastUsed = Date.now();
          return;
        }
        const mailbox = folder.id.startsWith(`${accountId}:`)
          ? folder.id.slice(accountId.length + 1)
          : folder.name;

        const client = new ImapFlow({
          host: account.imap.host,
          port: account.imap.port,
          secure: account.imap.secure,
          logger: getImapLogger(),
          auth: { user: account.imap.user, pass: account.imap.password },
          tls: {
            servername: account.imap.host,
            checkServerIdentity: (hostname, cert) => {
              if (!cert) return undefined;
              return tls.checkServerIdentity(hostname, cert);
            }
          },
          maxIdleTime: 10 * 60 * 1000,
          qresync: true
        });

        await logImapOp("imap.connect", { ...logContext, mailbox }, async () => {
          await client.connect();
        });
        const caps: any =
          (client as any).enabledCapabilities ||
          (client as any).serverCapabilities ||
          (client as any).capabilities ||
          null;
        const hasCap = (cap: string) => {
          if (!caps) return false;
          if (caps instanceof Set) return caps.has(cap) || caps.has(cap.toLowerCase());
          if (Array.isArray(caps)) return caps.includes(cap) || caps.includes(cap.toLowerCase());
          return false;
        };
        const supportsQresync = hasCap("QRESYNC");

        const storedState = await getMailboxState(accountId, folder.id);

        const mailboxOptions: any = { readOnly: true };
        if (supportsQresync) {
          mailboxOptions.qresync = true;
          if (storedState?.uidValidity && storedState?.highestModSeq) {
            mailboxOptions.uidValidity = storedState.uidValidity;
            mailboxOptions.changedSince = BigInt(storedState.highestModSeq);
          }
        }

        const mailboxInfo = await logImapOp(
          "imap.mailboxOpen",
          { ...logContext, mailbox, readOnly: true },
          async () => await client.mailboxOpen(mailbox, mailboxOptions)
        );
        const lastUidNext = mailboxInfo?.uidNext ?? 0;
        await saveMailboxState({
          accountId,
          folderId: folder.id,
          mailboxPath: mailbox,
          uidValidity: mailboxInfo?.uidValidity ? mailboxInfo.uidValidity.toString() : null,
          highestModSeq: (mailboxInfo as any)?.highestModseq
            ? (mailboxInfo as any).highestModseq.toString()
            : storedState?.highestModSeq ?? null,
          highestUid: lastUidNext ? lastUidNext - 1 : storedState?.highestUid ?? null,
          supportsQresync
        });
        sessions.set(folder.id, {
          mailbox,
          folderId: folder.id,
          client,
          lastUidNext,
          lastUsed: Date.now(),
          inbox: inboxFolder ? folder.id === inboxFolder.id : false
        });
        await enforceCapacity();
        send("folder:update", [
          {
            id: folder.id,
            uidNext: lastUidNext,
            unseen: (mailboxInfo as any)?.unseen ?? 0,
            exists: (mailboxInfo as any)?.exists ?? 0
          }
        ]);

        const fetchNew = async () => {
          const status = await logImapOp(
            "imap.status",
            { ...logContext, mailbox },
            async () => await client.status(mailbox, { uidNext: true })
          );
          const uidNext = status?.uidNext ?? lastUidNext;
          if (uidNext <= lastUidNext) return;
          const range = { uid: `${lastUidNext}:${uidNext - 1}` };
          const items = await logImapOp(
            "imap.fetch",
            { ...logContext, mailbox, range: range.uid },
            async () => {
              const list: Array<{
                uid: number;
                subject: string;
                from: string;
                date?: string | null;
                messageId?: string | null;
                folderId: string;
              }> = [];
              for await (const message of client.fetch(range, { uid: true, envelope: true })) {
                const env = message.envelope as Envelope | undefined;
                list.push({
                  uid: message.uid,
                  subject: env?.subject ?? "(no subject)",
                  from: formatAddress(env?.from),
                  date: env?.date ? env.date.toISOString() : null,
                  messageId: env?.messageId ?? null,
                  folderId: folder.id
                });
              }
              return list;
            }
          );
          if (items.length) {
            send("new", { uidNext, messages: items });
          }
          const watcher = Array.from(sessions.values()).find((c) => c.client === client);
          if (watcher) watcher.lastUidNext = uidNext;
          await saveMailboxState({
            accountId,
            folderId: folder.id,
            mailboxPath: mailbox,
            uidValidity: (mailboxInfo as any)?.uidValidity
              ? (mailboxInfo as any).uidValidity.toString()
              : null,
            highestModSeq: (status as any)?.highestModseq
              ? (status as any).highestModseq.toString()
              : null,
            highestUid: uidNext ? uidNext - 1 : null,
            supportsQresync
          });
        };

        client.on("exists", fetchNew);
        client.on("expunge", (info) => {
          const payload: any = { folderId: folder.id };
          if (info?.uid) payload.uid = info.uid;
          send("message:removed", payload);
        });
        client.on("flags", (info) => {
          const uid = info?.uid;
          if (!uid) return;
          send("flags:update", { folderId: folder.id, uid, flags: Array.from(info.flags ?? []) });
        });

        const idleLoop = async () => {
          while (!(client as any).closed) {
            try {
              await client.idle();
            } catch (error) {
              send("error", { folderId: folder.id, message: (error as Error).message });
              break;
            }
          }
        };

        void idleLoop();
      };

      try {
        if (inboxFolder) {
          await openWatcher(inboxFolder.id);
        }
        const uniqueFolders = new Set<string>();
        if (activeFolderId) uniqueFolders.add(activeFolderId);
        for (const fid of uniqueFolders) {
          if (!inboxFolder || fid !== inboxFolder.id) {
            await openWatcher(fid);
          }
        }

        // Polling loop for remaining folders
          const pollFolders = async () => {
            const watchIds = new Set(Array.from(sessions.keys()));
            const toPoll = folders.filter(
              (f) => !watchIds.has(f.id) && !removedFolderIds.has(f.id)
            );
            if (toPoll.length === 0) return;

          const pollClient = new ImapFlow({
            host: account.imap.host,
            port: account.imap.port,
            secure: account.imap.secure,
            logger: getImapLogger(),
            auth: { user: account.imap.user, pass: account.imap.password },
            tls: {
              servername: account.imap.host,
              checkServerIdentity: (hostname, cert) => {
                if (!cert) return undefined;
                return tls.checkServerIdentity(hostname, cert);
              }
            }
          });
          try {
            await logImapOp("imap.connect", { ...logContext, mailbox: "poll" }, async () => {
              await pollClient.connect();
            });
            const updates: Array<{ id: string; uidNext?: number; unseen?: number; exists?: number }>
              = [];
            for (const folder of toPoll) {
              const mailbox = folder.id.startsWith(`${accountId}:`)
                ? folder.id.slice(accountId.length + 1)
                : folder.name;
              try {
                const status = await logImapOp(
                  "imap.status",
                  { ...logContext, mailbox },
                  async () =>
                    await pollClient.status(mailbox, {
                      uidNext: true,
                      messages: true,
                      unseen: true
                    })
                );
                updates.push({
                  id: folder.id,
                  uidNext: status.uidNext,
                  unseen: status.unseen,
                  exists: status.messages
                });
              } catch {
                // ignore per-folder status errors
              }
            }
            if (updates.length) {
              send("folder:update", updates);
            }
          } catch (error) {
            send("error", { message: (error as Error).message ?? "Poll failed" });
          } finally {
            try {
              await logImapOp("imap.logout", { ...logContext, mailbox: "poll" }, async () => {
                await pollClient.logout();
              });
            } catch {
              // ignore
            }
          }
        };

        const pollTimer = setInterval(pollFolders, pollIntervalMs);

        request.signal.addEventListener("abort", () => {
          clearInterval(pollTimer);
        });
      } catch (error) {
        send("error", { message: (error as Error).message ?? "Stream failed" });
        await stopAll();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
