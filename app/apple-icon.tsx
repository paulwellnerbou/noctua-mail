import { renderEnvIcon } from "@/lib/ui/envIcon";

// Read APP_ENV_LABEL at request time so the badge reflects the deployment.
export const dynamic = "force-dynamic";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderEnvIcon({ size: 180 });
}
