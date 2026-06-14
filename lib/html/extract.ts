// Document-structure extraction: given raw HTML (possibly concatenated
// documents), pull out visible text, the preferred body, or the raw body
// content. Shared helpers splitConcatenatedHtmlDocuments / scoreHtmlDocument
// are kept local to this file — both selectPreferredHtmlDocument and
// extractBodyContent need them, nothing else does.

export function extractVisibleHtmlText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|blockquote|pre|table|tr|li|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|#160|#xa0);/gi, " ")
    .replace(/[\u00a0\u200b-\u200d\u2060\ufeff\ufffc]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitConcatenatedHtmlDocuments(input: string) {
  const trimmed = input.trim();
  const startMatch = trimmed.match(/^(?:<!doctype html>\s*)?<html[\s>]/i);
  if (!startMatch) return [input];

  const segments: string[] = [];
  let cursor = 0;
  const boundaryRe = /<\/html>\s*(?:<br\s*\/?>\s*)*(?=(?:<!doctype html>\s*)?<html[\s>])/gi;
  let boundary: RegExpExecArray | null;
  while ((boundary = boundaryRe.exec(trimmed))) {
    const end = boundary.index + boundary[0].length;
    segments.push(trimmed.slice(cursor, end));
    cursor = end;
  }

  if (segments.length === 0) return [input];
  segments.push(trimmed.slice(cursor));
  return segments.filter(Boolean);
}

function scoreHtmlDocument(html: string) {
  const visibleText = extractVisibleHtmlText(html);
  return {
    html,
    visibleTextLength: visibleText.length,
    hasMeaningfulText: /[\p{L}\p{N}]/u.test(visibleText),
    hasRenderableMedia: /<(img|table|svg|video|iframe|canvas|object|embed)\b/i.test(html),
    htmlLength: html.length
  };
}

export function selectPreferredHtmlDocument(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const candidates = splitConcatenatedHtmlDocuments(trimmed)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  if (candidates.length <= 1) return trimmed;

  const scored = candidates.map(scoreHtmlDocument);
  return (
    scored.find((candidate) => candidate.hasMeaningfulText)?.html ??
    scored.find((candidate) => candidate.hasRenderableMedia)?.html ??
    scored.find((candidate) => candidate.visibleTextLength > 0)?.html ??
    scored[0]?.html ??
    trimmed
  );
}

export function extractBodyContent(input: string) {
  const candidates = splitConcatenatedHtmlDocuments(input)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const normalizedCandidates = candidates.length > 0 ? candidates : [input];

  if (normalizedCandidates.length === 1 && !/<body[\s>]/i.test(normalizedCandidates[0] ?? "")) {
    return {
      body: normalizedCandidates[0] ?? "",
      styles: (normalizedCandidates[0] ?? "").match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [],
      bodyAttrs: { className: "", style: "", id: "" }
    };
  }

  const parts = normalizedCandidates.map((candidate) => {
    const scored = scoreHtmlDocument(candidate);
    const styles = candidate.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
    // Greedy body match: some real emails (e.g. ExactTarget/Salesforce sends)
    // nest a second <body> inside the outer one. A non-greedy match stops at
    // the first </body>, which closes the inner body right after the header and
    // drops the entire message. Match through the last </body> instead.
    const bodyMatch = candidate.match(/<body([^>]*)>([\s\S]*)<\/body>/i);
    const attrs = bodyMatch?.[1] ?? "";
    const classMatch = attrs.match(/class=["']([^"']+)["']/i);
    const styleMatch = attrs.match(/style=["']([^"']+)["']/i);
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);

    return {
      ...scored,
      styles,
      body: (bodyMatch?.[2] ?? candidate).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ""),
      bodyAttrs: {
        className: classMatch?.[1] ?? "",
        style: styleMatch?.[1] ?? "",
        id: idMatch?.[1] ?? ""
      }
    };
  });

  const visibleParts = parts.filter(
    (part) => part.hasMeaningfulText || part.hasRenderableMedia || part.visibleTextLength > 0
  );
  const renderedParts = visibleParts.length > 0 ? visibleParts : parts;
  const primaryPart =
    renderedParts.find((part) => part.bodyAttrs.className || part.bodyAttrs.style || part.bodyAttrs.id) ??
    renderedParts[0];

  return {
    body: renderedParts.map((part) => part.body).join(""),
    styles: renderedParts.flatMap((part) => part.styles),
    bodyAttrs: primaryPart?.bodyAttrs ?? { className: "", style: "", id: "" }
  };
}

export function extractHtmlBody(value: string) {
  // Greedy through the last </body>: emails that nest a second <body> inside
  // the outer one would otherwise be truncated at the first (inner) </body>.
  // See the matching note in extractBodyContent.
  const match = value.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (match?.[1]) return match[1];
  return value;
}
