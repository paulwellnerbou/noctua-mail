const BASE_APP_TITLE = "Noctua Mail";

type RuntimeConfig = { appEnvironmentLabel?: string };

/**
 * `APP_ENV_LABEL` is a server-only variable, so the browser reads the same
 * label from `public/runtime-config.js` instead — without this, titles set
 * from client components would silently drop the environment suffix.
 */
function readEnvLabel() {
  if (typeof window !== "undefined") {
    const runtimeConfig = (
      window as unknown as { __NOCTUA_RUNTIME_CONFIG__?: RuntimeConfig }
    ).__NOCTUA_RUNTIME_CONFIG__;
    return runtimeConfig?.appEnvironmentLabel?.trim() ?? "";
  }
  return process.env.APP_ENV_LABEL?.trim() ?? "";
}

function resolveAppTitle() {
  const staticTitle = process.env.NOCTUA_STATIC_APP_TITLE?.trim() ?? "";
  if (staticTitle) return staticTitle;
  const envLabel = readEnvLabel();
  return envLabel ? `${BASE_APP_TITLE} (${envLabel})` : BASE_APP_TITLE;
}

export const DEFAULT_APP_TITLE = resolveAppTitle();

const TITLE_SEPARATOR = " — ";

/**
 * Window titles lead with the segment that distinguishes one window from
 * another, because tab strips and taskbar buttons truncate the tail.
 */
function buildPageTitle(...segments: Array<string | null | undefined>) {
  const parts = segments.map((segment) => segment?.trim() ?? "").filter(Boolean);
  return [...parts, resolveAppTitle()].join(TITLE_SEPARATOR);
}

export function formatMessagePageTitle(subject?: string | null) {
  return buildPageTitle(subject);
}

/**
 * Kept distinct from `formatMessagePageTitle` so the raw-HTML view of a mail
 * is not indistinguishable from the detached window showing the same mail.
 */
export function formatMessageHtmlPageTitle(subject?: string | null) {
  const trimmed = subject?.trim() ?? "";
  return buildPageTitle(trimmed ? `HTML: ${trimmed}` : "HTML view");
}

export function formatComposePageTitle(subject?: string | null) {
  return buildPageTitle(subject?.trim() || "New message", "Compose");
}

export function formatCalendarPageTitle(accountEmail?: string | null) {
  return buildPageTitle("Calendar", accountEmail);
}

export function formatCalendarImportPageTitle(filename?: string | null) {
  const trimmed = filename?.trim() ?? "";
  return buildPageTitle(trimmed ? `Import ${trimmed}` : "Import invitation");
}

export function formatAttachmentPageTitle(filename?: string | null) {
  return buildPageTitle(filename?.trim() || "Attachment");
}

export function formatMailboxPageTitle(input: {
  folderName?: string | null;
  accountEmail?: string | null;
  unreadCount?: number | null;
}) {
  const folderName = input.folderName?.trim() || "Mail";
  const unread =
    typeof input.unreadCount === "number" && input.unreadCount > 0
      ? `(${input.unreadCount}) `
      : "";
  return buildPageTitle(`${unread}${folderName}`, input.accountEmail);
}
