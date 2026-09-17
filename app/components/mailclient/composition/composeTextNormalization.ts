export function normalizeHtmlDerivedText(value: string): string {
  return value.replace(/[ \t]+$/gm, "");
}
