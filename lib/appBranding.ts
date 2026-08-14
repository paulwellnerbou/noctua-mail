const BASE_APP_TITLE = "Noctua Mail";
const STATIC_APP_TITLE = process.env.NOCTUA_STATIC_APP_TITLE?.trim() ?? "";
const ENV_LABEL = process.env.APP_ENV_LABEL?.trim() ?? "";

const ENV_APP_TITLE = ENV_LABEL ? `${BASE_APP_TITLE} (${ENV_LABEL})` : BASE_APP_TITLE;

export const DEFAULT_APP_TITLE = STATIC_APP_TITLE || ENV_APP_TITLE;

export function formatMessagePageTitle(subject?: string | null) {
  const trimmedSubject = subject?.trim() ?? "";
  return trimmedSubject ? `${trimmedSubject} - ${DEFAULT_APP_TITLE}` : DEFAULT_APP_TITLE;
}

export function formatComposePageTitle() {
  return `Compose - ${DEFAULT_APP_TITLE}`;
}
