import sanitizeHtml from "sanitize-html";

// sanitize-html starts from a tight allowlist. Extend it to cover typical
// HTML-email markup the viewer wants to render: tables, images, stylesheets,
// document structure, etc. External stylesheets (<link>) remain disallowed —
// they're a tracking vector (CSS load leaks open) and can restyle the webmail
// UI when not sandboxed. <iframe>, <object>, <embed>, <form>, and <base> are
// excluded for the usual XSS/phishing reasons. <meta> is allowed only with
// the explicitly allowlisted attributes below (charset, name, content,
// http-equiv) — everything else on <meta> is stripped.
const SANITIZE_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "style",
    "html",
    "head",
    "meta",
    "body",
    "title",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "caption",
    "colgroup",
    "col",
    "center",
    "font",
    "u",
    "s",
    "strike"
  ],
  allowedAttributes: {
    "*": [
      "id",
      "class",
      "style",
      "title",
      "role",
      "dir",
      "lang",
      "xmlns",
      "xml:lang",
      "align",
      "valign",
      "bgcolor",
      "color",
      "width",
      "height"
    ],
    a: ["href", "name", "target", "rel"],
    img: ["src", "srcset", "alt", "title", "width", "height", "align"],
    table: ["border", "cellspacing", "cellpadding", "summary"],
    td: ["colspan", "rowspan", "headers", "scope"],
    th: ["colspan", "rowspan", "headers", "scope"],
    col: ["span"],
    colgroup: ["span"],
    font: ["face", "size"],
    body: ["bgcolor"],
    meta: ["charset", "name", "content", "http-equiv"]
  },
  allowedSchemes: ["http", "https", "mailto", "tel", "cid"],
  allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
  // Intentionally omit allowedStyles so inline style="..." attributes pass
  // through unfiltered. Emails rely on inline CSS for layout; sanitize-html
  // strips the whole style attribute when no explicit property allowlist
  // matches, and its allowlist schema does not accept a wildcard property
  // name.
  allowedClasses: { "*": [/.*/] },
  allowVulnerableTags: true,
  parser: { lowerCaseTags: true, lowerCaseAttributeNames: true }
};

export function sanitizeHtmlForDisplay(input: string) {
  if (!input) return input;
  return sanitizeHtml(input, SANITIZE_HTML_OPTIONS);
}
