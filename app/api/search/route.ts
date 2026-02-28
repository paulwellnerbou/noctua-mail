import { handleListMessagesRequest } from "../messages/listMessagesHandler";

export async function GET(request: Request) {
  return handleListMessagesRequest(request, { defaultQuery: "" });
}
