export type LinkifiedSegment =
  | { type: "text"; value: string }
  | { type: "url"; value: string };

const urlStartPattern = /https?:\/\//gi;
const urlCharacterPattern = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/;
const urlContinuationBoundaryPattern = /[\-._~:/?#[\]@!$&'()*+,;=%]/;

function isUrlCharacter(value: string) {
  return urlCharacterPattern.test(value);
}

function isUrlContinuationBoundary(value: string) {
  return urlContinuationBoundaryPattern.test(value);
}

function getSingleLineBreakEnd(text: string, index: number) {
  if (text[index] === "\r") {
    return text[index + 1] === "\n" ? index + 2 : index + 1;
  }
  if (text[index] === "\n") {
    return index + 1;
  }
  return null;
}

function hasUrlContinuationBoundaryAhead(text: string, start: number) {
  let index = start;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "\n" || char === "\r" || /\s/.test(char) || !isUrlCharacter(char)) {
      return false;
    }
    if (isUrlContinuationBoundary(char)) {
      return true;
    }
    index += 1;
  }
  return false;
}

function isSoftUrlBreak(text: string, index: number) {
  const lineBreakEnd = getSingleLineBreakEnd(text, index);
  if (lineBreakEnd === null) return false;
  const previousChar = text[index - 1] ?? "";
  const nextChar = text[lineBreakEnd] ?? "";
  if (index === 0 || !isUrlCharacter(previousChar)) return false;
  if (nextChar === "\n" || nextChar === "\r") return false;
  if (!isUrlCharacter(nextChar)) return false;
  if (isUrlContinuationBoundary(previousChar) || isUrlContinuationBoundary(nextChar)) {
    return true;
  }
  return hasUrlContinuationBoundaryAhead(text, lineBreakEnd);
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
      index = getSingleLineBreakEnd(text, index) ?? index;
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
