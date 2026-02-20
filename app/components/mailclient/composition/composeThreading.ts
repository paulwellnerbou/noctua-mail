import type { ComposeMode } from "./composeTypes";

export function shouldThreadComposeForMode(mode: ComposeMode) {
  return (
    mode === "reply" ||
    mode === "replyAll" ||
    mode === "forward" ||
    mode === "editAsNew" ||
    mode === "edit"
  );
}
