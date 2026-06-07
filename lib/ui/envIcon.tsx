import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Ribbon colors: orange band, white text.
const BADGE_BG = "#c94f00";
const BADGE_FG = "#ffffff";

// Base art is the committed, un-badged PNG set produced by generate_icons.sh.
// In the standalone build `public/` is copied next to the server (process.cwd()).
function baseIconPath(baseSize: number) {
  return join(process.cwd(), "public", "icons", `icon-${baseSize}.png`);
}

// The environment label is provided per-deployment at runtime (set by the
// container entrypoint / dev scripts), the same source the in-app badge reads.
export function getEnvLabel(): string {
  return process.env.APP_ENV_LABEL?.trim() ?? "";
}

function pngResponse(bytes: Buffer | Uint8Array): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      // Label only changes between deployments; let clients revalidate so a
      // redeploy with a different label is picked up.
      "Cache-Control": "public, max-age=0, must-revalidate"
    }
  });
}

/**
 * Returns a square app icon at `size`px. When an environment label is set, the
 * base art is rendered with a badge overlay so installed PWAs / favicons are
 * distinguishable; otherwise the original base PNG is returned untouched.
 */
export async function renderEnvIcon(opts: {
  size: number;
  baseSize?: number;
}): Promise<Response> {
  const { size } = opts;
  const baseSize = opts.baseSize ?? size;
  const base = await readFile(baseIconPath(baseSize));
  const label = getEnvLabel();

  if (!label) {
    return pngResponse(base);
  }

  const text = label.toUpperCase();
  const dataUri = `data:image/png;base64,${base.toString("base64")}`;

  // Scale the pill to the icon and shrink the font for longer labels so it
  // still fits within the pill at small sizes.
  const fontScale = Math.min(1, 4 / Math.max(text.length, 4));
  const fontSize = Math.max(7, Math.round(size * 0.12 * fontScale));

  // A corner ribbon across the top-right: a solid band rotated 45° whose ends
  // run off the top and right edges (clipped by the icon frame). `k` sets how
  // far in from the corner the band sits (i.e. how much of the corner it cuts).
  const k = size * 0.2;
  const bandWidth = size * 1.5;
  const bandHeight = Math.round(size * 0.155);
  const bandLeft = Math.round(size - k - bandWidth / 2);
  const bandTop = Math.round(k - bandHeight / 2);

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: size,
          height: size
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          width={size}
          height={size}
          src={dataUri}
          alt=""
          style={{ position: "absolute", top: 0, left: 0 }}
        />
        <div
          style={{
            position: "absolute",
            top: bandTop,
            left: bandLeft,
            width: bandWidth,
            height: bandHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: BADGE_BG,
            color: BADGE_FG,
            fontSize,
            fontWeight: 700,
            letterSpacing: 1,
            transform: "rotate(45deg)",
            transformOrigin: "center",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
          }}
        >
          {text}
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate"
      }
    }
  );
}
