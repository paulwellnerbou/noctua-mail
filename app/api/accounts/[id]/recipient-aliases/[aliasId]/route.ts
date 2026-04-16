import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import {
  RecipientAliasConflictError,
  deleteRecipientAlias,
  updateRecipientAlias
} from "@/lib/recipientAliases";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; aliasId?: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { aliasId: rawAliasId } = await params;
  const aliasId = typeof rawAliasId === "string" ? rawAliasId.trim() : "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string;
        recipients?: string;
      }
    | null;
  const changes: { name?: string; recipients?: string } = {};
  if (body?.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ ok: false, message: "Missing name" }, { status: 400 });
    }
    changes.name = name;
  }
  if (body?.recipients !== undefined) {
    const recipients = body.recipients.trim();
    if (!recipients) {
      return NextResponse.json({ ok: false, message: "Missing recipients" }, { status: 400 });
    }
    changes.recipients = recipients;
  }

  try {
    const alias = await updateRecipientAlias(accountId, aliasId, changes);
    if (!alias) {
      return NextResponse.json({ ok: false, message: "Recipient alias not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, alias });
  } catch (error) {
    if (error instanceof RecipientAliasConflictError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { aliasId: rawAliasId } = await params;
  const aliasId = typeof rawAliasId === "string" ? rawAliasId.trim() : "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const deleted = await deleteRecipientAlias(accountId, aliasId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Recipient alias not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
