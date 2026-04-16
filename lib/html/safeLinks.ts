/**
 * Post-process sanitized HTML to enforce safe link attributes:
 *   - `target="_blank"` so external links open in a new tab
 *   - `rel="noopener noreferrer"` to prevent reverse-tabnabbing and
 *     referer leakage
 *
 * Use this AFTER `sanitizeHtmlForDisplay`. The sanitizer allow-lists tags
 * and attributes but intentionally leaves `target`/`rel` policy up to the
 * caller, since different surfaces (message viewer vs. calendar details
 * vs. calendar email snapshot) may want different defaults.
 *
 * Pure function, no DOM — safe to call on the server and in unit tests.
 */
export function enforceSafeLinks(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (_, attrs: string) => {
    let result = attrs.trim();
    if (!/\btarget\s*=/.test(result)) {
      result = result ? `${result} target="_blank"` : 'target="_blank"';
    }
    if (/\brel\s*=/.test(result)) {
      result = result.replace(
        /\brel\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/i,
        (_m, _full, dq, sq, uq) => {
          const value = dq ?? sq ?? uq ?? "";
          const tokens = value.split(/\s+/).filter(Boolean);
          if (!tokens.includes("noopener")) tokens.push("noopener");
          if (!tokens.includes("noreferrer")) tokens.push("noreferrer");
          return `rel="${tokens.join(" ")}"`;
        }
      );
    } else {
      result = result ? `${result} rel="noreferrer noopener"` : 'rel="noreferrer noopener"';
    }
    return result ? `<a ${result}>` : "<a>";
  });
}
