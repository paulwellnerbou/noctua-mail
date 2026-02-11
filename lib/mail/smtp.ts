import type { Account } from "@/lib/data";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";

const PROJECT_URL = "https://github.com/paulwellnerbou/noctua-mail";
const MAILER_ID = `Noctua Mail (${PROJECT_URL})`;

type MailPayload = {
  to?: string;
  cc?: string;
  bcc?: string;
  keepBcc?: boolean;
  subject: string;
  text: string;
  html?: string;
  messageId?: string;
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
  const to = mail.to?.trim() || undefined;
  const cc = mail.cc?.trim() || undefined;
  const bcc = mail.bcc?.trim() || undefined;
  const fromValue = {
    name: account.name,
    address: account.email
  };
  const attachments = mail.attachments?.map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content,
    contentType: attachment.contentType,
    cid: attachment.cid,
    contentDisposition: attachment.inline ? "inline" : "attachment"
  }));
  return {
    from: fromValue,
    to,
    cc,
    bcc,
    replyTo: mail.replyTo,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    headers: {
      "User-Agent": MAILER_ID,
      "X-Mailer": MAILER_ID,
      ...(mail.xForwardedMessageId ? { "X-Forwarded-Message-Id": mail.xForwardedMessageId } : {})
    }
  };
}

export async function buildRawMessage(account: Account, mail: MailPayload) {
  const mailOptions = buildMailOptions(account, mail);
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const composer = new MailComposer(mailOptions);
    const compiled = composer.compile();
    if (mail.keepBcc) {
      (compiled as { keepBcc?: boolean }).keepBcc = true;
    }
    compiled.build((error: Error | null, message: Buffer) => {
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
