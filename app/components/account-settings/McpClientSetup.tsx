"use client";

import { useMemo, useState } from "react";
import { Card, Flex, SegmentedControl, Text } from "@radix-ui/themes";
import RawTextPanel from "@/app/components/mailclient/message/RawTextPanel";
import {
  MCP_TOKEN_PLACEHOLDER,
  buildMcpClientSetupSections,
  type McpClientId
} from "@/lib/mcpClientSetup";

type Props = {
  serverUrl: string;
  /** Secret of the token created in this session, if any. */
  token?: string | null;
};

export default function McpClientSetup({ serverUrl, token }: Props) {
  const [clientId, setClientId] = useState<McpClientId>("claude");
  const sections = useMemo(
    () => buildMcpClientSetupSections({ serverUrl, token }),
    [serverUrl, token]
  );
  const section = sections.find((item) => item.id === clientId) ?? sections[0];

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Text size="3" weight="medium">Connect a client</Text>
          <SegmentedControl.Root
            size="1"
            value={section.id}
            onValueChange={(value) => setClientId(value as McpClientId)}
          >
            {sections.map((item) => (
              <SegmentedControl.Item key={item.id} value={item.id}>
                {item.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </Flex>
        <Text size="1" color="gray">
          {token
            ? "The snippets below already contain the token you just created."
            : `Create a token above, then replace ${MCP_TOKEN_PLACEHOLDER} in the snippets with its secret.`}
        </Text>
        {section.steps.map((step) => (
          <Flex key={step.title} direction="column" gap="2">
            <Text size="2" weight="medium">{step.title}</Text>
            {step.note && (
              <Text size="1" color="gray">{step.note}</Text>
            )}
            {step.code && (
              <RawTextPanel
                text={step.code}
                copyText={step.code}
                copyLabel={step.copyLabel ?? "Copy"}
                constrainHeight={false}
              />
            )}
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}
