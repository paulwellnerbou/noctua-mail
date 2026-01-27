import type { Account } from "@/lib/data";

type MailPayload = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  replyTo?: string;
  xForwardedMessageId?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: Buffer;
    cid?: string;
    inline?: boolean;
  }>;
};

function buildMailOptions(account: Account, mail: MailPayload) {
  const fromValue = account.name ? `"${account.name}" <${account.email}>` : account.email;
  const attachments = mail.attachments?.map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content,
    contentType: attachment.contentType,
    cid: attachment.cid,
    contentDisposition: attachment.inline ? "inline" : "attachment"
  }));
  return {
    from: fromValue,
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    replyTo: mail.replyTo,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    headers: {
      "User-Agent": "Noctua Mail",
      "X-Mailer": "Noctua Mail",
      ...(mail.xForwardedMessageId ? { "X-Forwarded-Message-Id": mail.xForwardedMessageId } : {})
    }
  };
}

export async function buildRawMessage(account: Account, mail: MailPayload) {
  let MailComposer: any;
  try {
    const composerModule = await import("nodemailer/lib/mail-composer");
    MailComposer = (composerModule as any).default ?? composerModule;
  } catch {
    throw new Error("SMTP composer is missing. Run `bun install` to add nodemailer.");
  }

  const mailOptions = buildMailOptions(account, mail);
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const composer = new MailComposer(mailOptions);
    composer.compile().build((error: Error | null, message: Buffer) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(message);
    });
  });

  return raw;
}

export async function sendSmtpMessage(account: Account, mail: MailPayload) {
  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = await import("nodemailer");
  } catch {
    throw new Error("SMTP library is missing. Run `bun install` to add nodemailer.");
  }

  const transporter = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: {
      user: account.smtp.user,
      pass: account.smtp.password
    }
  });

  const mailOptions = buildMailOptions(account, mail);
  const raw = await buildRawMessage(account, mail);

  const info = await transporter.sendMail(mailOptions);
  return { messageId: (info as any)?.messageId ?? null, raw };
}
