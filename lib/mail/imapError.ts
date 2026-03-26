type ImapErrorLike = {
  message?: string;
  response?: string;
  responseText?: string;
  responseStatus?: string;
  executedCommand?: string;
  serverResponseCode?: string;
  authenticationFailed?: boolean;
};

type ImapHttpError = {
  status: number;
  message: string;
  code: "imap_auth_failed" | "imap_password_missing";
  reauthRequired: true;
};

function collectImapErrorText(error: unknown) {
  const candidate = error as ImapErrorLike | null | undefined;
  return [
    candidate?.message,
    candidate?.response,
    candidate?.responseText,
    candidate?.responseStatus,
    candidate?.executedCommand,
    candidate?.serverResponseCode
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();
}

export function getImapHttpError(error: unknown): ImapHttpError | null {
  const candidate = error as ImapErrorLike | null | undefined;
  const text = collectImapErrorText(error);

  if (text.includes("no password configured")) {
    return {
      status: 401,
      message: "No password configured",
      code: "imap_password_missing",
      reauthRequired: true
    };
  }

  const authCommand =
    typeof candidate?.executedCommand === "string" &&
    /\b(?:authenticate|login)\b/i.test(candidate.executedCommand);
  const authFailed =
    candidate?.authenticationFailed === true ||
    candidate?.serverResponseCode === "AUTHENTICATIONFAILED" ||
    (candidate?.responseStatus === "NO" && authCommand) ||
    text.includes("authentication failed") ||
    text.includes("invalid credentials") ||
    text.includes("authenticationsucceeded") === false && text.includes("authenticate plain");

  if (authFailed) {
    return {
      status: 401,
      message: "Invalid IMAP credentials",
      code: "imap_auth_failed",
      reauthRequired: true
    };
  }

  return null;
}
