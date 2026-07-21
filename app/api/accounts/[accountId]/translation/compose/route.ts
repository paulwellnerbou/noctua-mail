import { NextResponse } from "next/server";
import {
  DeeplError,
  deeplTranslate,
  extractInlineData,
  restoreInlineData,
  type DeeplFormat
} from "@/lib/deepl";
import { normalizeDeeplTargetLang } from "@/lib/deeplLanguages";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";

/**
 * Translates compose-draft text supplied in the request body. Unlike the
 * per-message translate route this is not cached: a draft has no stable
 * identity and its text changes with every edit, so cache hits would be
 * near zero.
 */
export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);

  const context = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (context instanceof NextResponse) return context;

  const deepl = context.account.deepl;
  if (!deepl?.enabled) {
    return NextResponse.json(
      { ok: false, message: "Translation is not enabled for this account." },
      { status: 400 }
    );
  }
  const apiKey = deepl.apiKey?.trim() ?? "";
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: "No DeepL API key is configured for this account." },
      { status: 400 }
    );
  }

  // Parse the body only after auth so an unauthenticated caller can't force
  // request-body parsing work.
  const payload = (await request.json().catch(() => null)) as
    | { text?: string; targetLang?: string; format?: string }
    | null;
  const format: DeeplFormat = payload?.format === "html" ? "html" : "text";
  const targetLang = normalizeDeeplTargetLang(payload?.targetLang ?? deepl.targetLang);
  const rawSource = typeof payload?.text === "string" ? payload.text : "";
  if (!rawSource.trim()) {
    return NextResponse.json(
      { ok: false, message: "There is no content to translate." },
      { status: 400 }
    );
  }
  // Inline images in an HTML draft are embedded as data: URLs — pull them out
  // behind placeholders (they blow DeepL's size limit and aren't translatable)
  // and splice them back into the result.
  const { text: sourceText, tokens: inlineData, marker } = extractInlineData(rawSource);

  try {
    const result = await deeplTranslate({ apiKey, text: sourceText, targetLang, format });
    return NextResponse.json({
      ok: true,
      format,
      targetLang,
      translatedText: restoreInlineData(result.text, inlineData, marker),
      detectedSourceLang: result.detectedSourceLang
    });
  } catch (error) {
    if (error instanceof DeeplError) {
      // 403 means the key is bad — surface as a 400 so the client shows the
      // actionable message instead of tripping any auth handling on 401/403.
      const status =
        error.status === 403
          ? 400
          : error.status >= 400 && error.status < 600
            ? error.status
            : 502;
      return NextResponse.json({ ok: false, message: error.message }, { status });
    }
    const message = error instanceof Error ? error.message : "Translation failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
