import { NextResponse } from "next/server";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { requireMcpAccountContext } from "@/lib/auth";
import { executeMcpHttpRequest } from "@/lib/mcpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function lowerCaseHeaderRecord(headers: Headers) {
  return Object.fromEntries(
    Array.from(headers.entries()).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function jsonRpcErrorResponse(status: number, code: number, message: string) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      error: { code, message },
      id: null
    },
    { status }
  );
}

function methodNotAllowedResponse() {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      error: { code: ErrorCode.InvalidRequest, message: "Method not allowed" },
      id: null
    },
    {
      status: 405,
      headers: {
        Allow: "POST"
      }
    }
  );
}

export async function POST(request: Request) {
  const context = await requireMcpAccountContext(request);
  if (context instanceof NextResponse) {
    return context;
  }

  const body = await request.json().catch(() => null);
  if (body == null) {
    return jsonRpcErrorResponse(400, ErrorCode.ParseError, "Invalid JSON body");
  }

  const headers = lowerCaseHeaderRecord(request.headers);
  const authInfo: AuthInfo = {
    token: context.rawToken,
    clientId: `mcp-token:${context.tokenRecord.id}`,
    scopes: [],
    expiresAt: context.session.exp,
    extra: {
      accountId: context.accountId,
      userId: context.session.userId,
      tokenId: context.tokenRecord.id
    }
  };

  const result = await executeMcpHttpRequest({
    body,
    accountId: context.accountId,
    account: context.account,
    tokenRecord: context.tokenRecord,
    authInfo,
    requestInfo: {
      headers: headers as never
    }
  });

  const payload =
    result.responses.length === 1 ? result.responses[0] : result.responses;

  if (result.responses.length === 0) {
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(payload);
}

export async function GET() {
  return methodNotAllowedResponse();
}

export async function DELETE() {
  return methodNotAllowedResponse();
}
