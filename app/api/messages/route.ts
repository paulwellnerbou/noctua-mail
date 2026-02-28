import { handleListMessagesRequest } from "./listMessagesHandler";

export async function GET(request: Request) {
  return handleListMessagesRequest(request);
}
