type ServerSmtpModule = typeof import("./mail/smtp");

const SERVER_SMTP_SPECIFIER = "./mail/smtp.ts?server-runtime";

function loadServerSmtp(): Promise<ServerSmtpModule> {
  return import(SERVER_SMTP_SPECIFIER);
}

export async function buildRawMessage(
  ...args: Parameters<ServerSmtpModule["buildRawMessage"]>
) {
  const smtp = await loadServerSmtp();
  return smtp.buildRawMessage(...args);
}
