import { NextResponse } from "next/server";

const LEGACY_ACCOUNT_ROUTE_MESSAGE =
  "This endpoint has been removed. Use the account-scoped /api/accounts/:accountId/... routes instead.";

export async function legacyAccountRouteRemoved(_request: Request) {
  return NextResponse.json(
    {
      ok: false,
      message: LEGACY_ACCOUNT_ROUTE_MESSAGE
    },
    { status: 410 }
  );
}
