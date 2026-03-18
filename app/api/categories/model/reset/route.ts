import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { resetCategoryLinearModel } from "@/lib/db";

export async function handleCategoryModelResetRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
      }
    | null;
  const accountId = options?.accountId ?? "";
  const access = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (access instanceof NextResponse) return access;

  try {
    const model = await resetCategoryLinearModel(accountId);
    return NextResponse.json({
      ok: true,
      model: {
        version: model.version,
        examples: model.examples,
        updatedAt: model.updatedAt
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset categorization model";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
