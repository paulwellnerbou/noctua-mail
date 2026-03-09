export type LinkifiedSegment =
  | { type: "text"; value: string }
  | { type: "url"; value: string };

const urlStartPattern = /https?:\/\//gi;
const urlCharacterPattern = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/;

function isUrlCharacter(value: string) {
  return urlCharacterPattern.test(value);
}

function isSoftUrlBreak(text: string, index: number) {
  if (text[index] !== "\n" && text[index] !== "\r") return false;
  if (index === 0 || !isUrlCharacter(text[index - 1] ?? "")) return false;
  let nextIndex = index;
  while (text[nextIndex] === "\n" || text[nextIndex] === "\r") {
    nextIndex += 1;
  }
  return isUrlCharacter(text[nextIndex] ?? "");
}

function readUrl(text: string, start: number) {
  let index = start;
  let normalized = "";

  while (index < text.length) {
    const char = text[index] ?? "";
    if (isUrlCharacter(char)) {
      normalized += char;
      index += 1;
      continue;
    }
    if (isSoftUrlBreak(text, index)) {
      while (text[index] === "\n" || text[index] === "\r") {
        index += 1;
      }
      continue;
    }
    break;
  }

  return {
    end: index,
    url: normalized
  };
}

export function splitTextWithUrls(text: string): LinkifiedSegment[] {
  const segments: LinkifiedSegment[] = [];
  let cursor = 0;

  urlStartPattern.lastIndex = 0;

  while (cursor < text.length) {
    const match = urlStartPattern.exec(text);
    if (!match) break;
    if (match.index < cursor) {
      urlStartPattern.lastIndex = cursor;
      continue;
    }

    const start = match.index;
    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }

    const { end, url } = readUrl(text, start);
    segments.push({ type: "url", value: url });
    cursor = end;
    urlStartPattern.lastIndex = end;
  }

  if (cursor < text.length || segments.length === 0) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}
