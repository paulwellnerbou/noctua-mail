import { NextResponse } from "next/server";
import { DeeplError, deeplUsage, isDeeplFreeKey } from "@/lib/deepl";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const payload = (await request.json().catch(() => null)) as { apiKey?: string } | null;

  const context = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (context instanceof NextResponse) return context;

  // Prefer a key typed into the form; fall back to the stored key so the test
  // works for an already-saved account (the form field is blank by design).
  const provided = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
  const apiKey = provided || (context.account.deepl?.apiKey ?? "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: "Enter a DeepL API key to test." },
      { status: 400 }
    );
  }

  try {
    const usage = await deeplUsage(apiKey);
    return NextResponse.json({
      ok: true,
      plan: isDeeplFreeKey(apiKey) ? "free" : "pro",
      characterCount: usage.characterCount,
      characterLimit: usage.characterLimit
    });
  } catch (error) {
    if (error instanceof DeeplError) {
      const status =
        error.status === 403
          ? 400
          : error.status >= 400 && error.status < 600
            ? error.status
            : 502;
      return NextResponse.json({ ok: false, message: error.message }, { status });
    }
    const message = error instanceof Error ? error.message : "Could not verify the DeepL key.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
