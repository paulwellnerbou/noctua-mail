import { NextResponse } from "next/server";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";
import { resetCategoryLinearModel } from "@/lib/db";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
      }
    | null;
  const accountId = payload?.accountId?.trim() ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(session, accountId);
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
