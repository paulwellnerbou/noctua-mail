const malformedDuplicateUrlPattern = /(https?:\/\/[^\s\]]+)\s+\[\1\]/gi;
const tightAsteriskWordPattern = /\*([^*\n]+)\*(?=[A-Za-z0-9ÄÖÜäöü])/g;

export function normalizeMarkdownBody(body: string): string {
  return body
    .replace(malformedDuplicateUrlPattern, "<$1>")
    .replace(tightAsteriskWordPattern, "*$1* ");
}
