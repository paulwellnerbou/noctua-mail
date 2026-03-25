function isSeparator(char: string) {
  return char === "," || char === ";";
}

export function splitRecipientEntries(value?: string | null): string[] {
  const input = (value ?? "").trim();
  if (!input) return [];

  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const previous = index > 0 ? input[index - 1] : "";

    if (char === "\"" && previous !== "\\") {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes) {
      if (char === "<") {
        angleDepth += 1;
      } else if (char === ">" && angleDepth > 0) {
        angleDepth -= 1;
      } else if (isSeparator(char) && angleDepth === 0) {
        const next = current.trim();
        if (next) {
          parts.push(next);
        }
        current = "";
        continue;
      }
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) {
    parts.push(tail);
  }
  return parts;
}

function collapseRecipientWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function hasTrailingRecipientSeparator(value: string) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const char = value[index];
    if (/\s/.test(char)) {
      continue;
    }
    return isSeparator(char);
  }
  return false;
}

export function getRecipientInputToken(value: string) {
  if (!value.trim()) {
    return "";
  }
  if (hasTrailingRecipientSeparator(value)) {
    return "";
  }
  const entries = splitRecipientEntries(value);
  return entries[entries.length - 1]?.trim() ?? "";
}

export function replaceLastRecipientToken(value: string, replacement: string) {
  const entries = splitRecipientEntries(value);
  if (entries.length === 0 || hasTrailingRecipientSeparator(value)) {
    entries.push(replacement);
  } else {
    entries[entries.length - 1] = replacement;
  }
  const joined = entries.map((entry) => entry.trim()).filter(Boolean).join(", ");
  return joined ? `${joined}, ` : `${replacement}, `;
}

export function normalizeRecipientListForComparison(value?: string | null) {
  return splitRecipientEntries(value)
    .map((entry) => collapseRecipientWhitespace(entry).toLowerCase())
    .filter(Boolean)
    .join(", ");
}

export function countRecipientEntries(value?: string | null) {
  return splitRecipientEntries(value).length;
}
