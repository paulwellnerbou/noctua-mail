import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getEnvLabel } from "@/lib/ui/envIcon";

// Read APP_ENV_LABEL at request time so the ribbon reflects the deployment.
export const dynamic = "force-dynamic";

// Vector base art (bird on gradient), shipped in public/ so it is available in
// the standalone build. The ribbon is composed in the same coordinate space.
function baseSvgPath() {
  return join(process.cwd(), "public", "icons", "base.svg");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Corner ribbon across the top-right, matching the raster version in
// envIcon.tsx. Coordinates are in the base viewBox space (-100 -100 1800 1800),
// so the band's center sits at 80%/20% of the canvas and its ends run off the
// edges (clipped by the SVG viewBox).
function ribbonMarkup(label: string) {
  const text = escapeXml(label.toUpperCase());
  // Shrink the font for longer labels so they stay within the band.
  const fontScale = Math.min(1, 4 / Math.max(label.length, 4));
  const fontSize = Math.round(306 * fontScale);
  const cx = 1340;
  const cy = 260;
  const rotate = `rotate(45 ${cx} ${cy})`;

  return (
    `<g>` +
    `<defs>` +
    `<filter id="ribbonShadow" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.3"/>` +
    `</filter>` +
    `</defs>` +
    `<rect x="-10" y="71" width="2700" height="378" fill="#c94f00" ` +
    `filter="url(#ribbonShadow)" transform="${rotate}"/>` +
    `<text x="${cx}" y="${cy}" transform="${rotate}" fill="#ffffff" ` +
    `font-family="-apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" ` +
    `font-weight="700" font-size="${fontSize}" letter-spacing="6" ` +
    `text-anchor="middle" dominant-baseline="central">${text}</text>` +
    `</g>`
  );
}

export async function GET() {
  const baseSvg = await readFile(baseSvgPath(), "utf8");
  const label = getEnvLabel();

  const svg = label
    ? baseSvg.replace(/<\/svg>\s*$/, `${ribbonMarkup(label)}</svg>`)
    : baseSvg;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate"
    }
  });
}
