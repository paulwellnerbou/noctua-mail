import { renderEnvIcon } from "@/lib/ui/envIcon";

// Read APP_ENV_LABEL at request time so the badge reflects the deployment.
export const dynamic = "force-dynamic";

// Sizes that exist in public/icons and are referenced by the PWA manifest.
const ALLOWED_SIZES = new Set([32, 192, 512]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size } = await params;
  const parsed = Number(size);

  if (!ALLOWED_SIZES.has(parsed)) {
    return new Response("Not found", { status: 404 });
  }

  return renderEnvIcon({ size: parsed });
}
