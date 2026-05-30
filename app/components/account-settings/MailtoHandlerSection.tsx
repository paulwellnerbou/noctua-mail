"use client";

import { useState } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import { DEFAULT_APP_TITLE } from "@/lib/appBranding";

type Status =
  | { kind: "idle" }
  | { kind: "ok" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

// `mailto:` registration is a browser-wide setting, not per-account, but the
// preferences tab is the most discoverable place to expose it. The actual
// "set as system default" step happens in the OS — we just tell the browser
// it's willing to handle the protocol.
export default function MailtoHandlerSection() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const handleRegister = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (typeof navigator.registerProtocolHandler !== "function") {
      setStatus({ kind: "unsupported" });
      return;
    }
    try {
      navigator.registerProtocolHandler(
        "mailto",
        `${window.location.origin}/?mailto=%s`
      );
      setStatus({ kind: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed.";
      setStatus({ kind: "error", message });
    }
  };

  return (
    <Flex direction="column" gap="2">
      <Text size="3" weight="medium">
        Default mail app
      </Text>
      <Text size="1" color="gray">
        Ask your browser to handle <code>mailto:</code> links with {DEFAULT_APP_TITLE}. After
        registering, you may need to pick {DEFAULT_APP_TITLE} when your browser prompts you,
        and then set the browser itself as the system default in your OS settings. Not supported
        in Safari.
      </Text>
      <Flex align="center" gap="3" wrap="wrap">
        <Button size="2" variant="soft" onClick={handleRegister}>
          Register as mailto: handler
        </Button>
        {status.kind === "ok" && (
          <Text size="1" color="green">
            Requested — check your browser for a confirmation prompt.
          </Text>
        )}
        {status.kind === "unsupported" && (
          <Text size="1" color="amber">
            This browser doesn&apos;t support protocol handler registration.
          </Text>
        )}
        {status.kind === "error" && (
          <Text size="1" color="red">
            {status.message}
          </Text>
        )}
      </Flex>
    </Flex>
  );
}
