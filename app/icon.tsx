import { renderEnvIcon } from "@/lib/ui/envIcon";

// Read APP_ENV_LABEL at request time so the badge reflects the deployment.
export const dynamic = "force-dynamic";

export const size = { width: 256, height: 256 };
export const contentType = "image/png";

export default function Icon() {
  return renderEnvIcon({ size: 256 });
}
