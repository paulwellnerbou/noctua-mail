import { parse, parseFragment, serialize } from "parse5";

// sanitize-html parses with htmlparser2, which is not an HTML5 tree builder.
// On the malformed table markup mail generators emit (XING's newsletter opens
// a <tr> straight inside a <td>) it closes the enclosing elements early and
// drops the end tags left over, so everything past the damage escapes its
// wrapper: a footer inside a <td align="center"> becomes a sibling of the
// layout table and renders full-width. parse5 applies the spec's error
// recovery, so normalizing first hands the sanitizer the tree the browser
// would have built — and leaves less room for the two to disagree.
export function normalizeHtmlStructure(input: string) {
  if (!input) return input;
  // parse() imposes an html/head/body skeleton that callers passing bare
  // fragments don't expect; parseFragment() drops one that is already there.
  // Only markers a fragment cannot carry count as a document: a leading
  // doctype, or an <html>/<body> tag. A <head>/<meta>/<title> lead-in does
  // not — email fragments open with <meta charset> often enough that treating
  // it as a document would wrap ordinary fragments in a skeleton.
  const isDocument = /^\s*<!doctype\b/i.test(input) || /<(?:html|body)[\s>]/i.test(input);
  return serialize(isDocument ? parse(input) : parseFragment(input));
}
