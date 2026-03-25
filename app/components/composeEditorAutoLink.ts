import type { LinkMatcher } from "@lexical/link";

export type ComposeAutoLinkMatch = {
  index: number;
  length: number;
  text: string;
  url: string;
};

const HTTP_URL_PATTERN = /https?:\/\/[^\s<]+/i;
const MAILTO_URL_PATTERN = /mailto:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function trimTrailingPunctuation(value: string) {
  return value.replace(TRAILING_PUNCTUATION, "");
}

function createMatcher(pattern: RegExp, urlTransformer?: (text: string) => string): LinkMatcher {
  return (text: string) => {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) return null;

    const matchedText = trimTrailingPunctuation(match[0]);
    if (!matchedText) return null;

    return {
      index: match.index,
      length: matchedText.length,
      text: matchedText,
      url: urlTransformer ? urlTransformer(matchedText) : matchedText
    };
  };
}

export const composeAutoLinkMatchers: LinkMatcher[] = [
  createMatcher(HTTP_URL_PATTERN),
  createMatcher(MAILTO_URL_PATTERN),
  createMatcher(EMAIL_PATTERN, (text) => `mailto:${text}`)
];

export function findComposeAutoLinkMatch(text: string): ComposeAutoLinkMatch | null {
  let bestMatch: ComposeAutoLinkMatch | null = null;

  for (const matcher of composeAutoLinkMatchers) {
    const match = matcher(text);
    if (!match) continue;
    if (!bestMatch || match.index < bestMatch.index) {
      bestMatch = match;
      continue;
    }
    if (match.index === bestMatch.index && match.length > bestMatch.length) {
      bestMatch = match;
    }
  }

  return bestMatch;
}

export function collectComposeAutoLinkMatches(text: string): ComposeAutoLinkMatch[] {
  const matches: ComposeAutoLinkMatch[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const match = findComposeAutoLinkMatch(text.slice(cursor));
    if (!match) break;

    matches.push({
      ...match,
      index: match.index + cursor
    });

    const nextCursor = cursor + match.index + match.length;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }

  return matches;
}
