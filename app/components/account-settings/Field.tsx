import type { ReactNode } from "react";
import { Flex, Text } from "@radix-ui/themes";

type FieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

export default function Field({ label, hint, children }: FieldProps) {
  return (
    <Flex direction="column" gap="1">
      <Text size="2" weight="medium">
        {label}
      </Text>
      {children}
      {hint && (
        <Text size="1" color="gray">
          {hint}
        </Text>
      )}
    </Flex>
  );
}
