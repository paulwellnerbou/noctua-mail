export const DEFAULT_APP_TITLE = "Noctua Mail";

type EnvMap = Record<string, string | undefined>;

function normalize(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

export function getAppTitle(env: EnvMap = process.env) {
  const environmentLabel = getAppEnvironmentLabel(env);
  if (!environmentLabel) return DEFAULT_APP_TITLE;
  return `${DEFAULT_APP_TITLE} (${environmentLabel})`;
}

export function getAppEnvironmentLabel(env: EnvMap = process.env) {
  return normalize(env.APP_ENV_LABEL);
}

export function getAppBranding(env: EnvMap = process.env) {
  return {
    title: getAppTitle(env),
    environmentLabel: getAppEnvironmentLabel(env)
  };
}
