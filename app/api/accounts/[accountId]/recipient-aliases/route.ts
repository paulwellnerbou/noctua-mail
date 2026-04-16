import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import {
  RecipientAliasConflictError,
  createRecipientAlias,
  listRecipientAliases
} from "@/lib/recipientAliases";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const aliases = await listRecipientAliases(accountId);
  return NextResponse.json({ ok: true, aliases });
}

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string;
        recipients?: string;
      }
    | null;
  const name = body?.name?.trim() ?? "";
  const recipients = body?.recipients?.trim() ?? "";

  if (!name) {
    return NextResponse.json({ ok: false, message: "Missing name" }, { status: 400 });
  }
  if (!recipients) {
    return NextResponse.json({ ok: false, message: "Missing recipients" }, { status: 400 });
  }

  try {
    const alias = await createRecipientAlias(accountId, name, recipients);
    return NextResponse.json({ ok: true, alias }, { status: 201 });
  } catch (error) {
    if (error instanceof RecipientAliasConflictError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 409 });
    }
    throw error;
  }
}
