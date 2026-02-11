"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Box, Flex, IconButton, Popover, Text } from "@radix-ui/themes";
import { getExceptionDetail, getExceptionSummary } from "../utils/clientHelpers";
import type { ExceptionEntry } from "../types";
import {
  BottomStatusTriggerButton,
  type BottomStatusTone
} from "./BottomStatusSection";

type ExceptionStatusPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exceptionEntries: ExceptionEntry[];
  onClearExceptions: () => void;
  formatRelativeTime: (timestamp?: number | null) => string;
};

export default function ExceptionStatusPopover({
  open,
  onOpenChange,
  exceptionEntries,
  onClearExceptions,
  formatRelativeTime
}: ExceptionStatusPopoverProps) {
  const [selectedExceptionId, setSelectedExceptionId] = useState<string | null>(null);
  const latestException = exceptionEntries[0] ?? null;
  const selectedException = useMemo(() => {
    if (exceptionEntries.length === 0) return null;
    if (!selectedExceptionId) return exceptionEntries[0];
    return (
      exceptionEntries.find((entry) => entry.id === selectedExceptionId) ?? exceptionEntries[0]
    );
  }, [exceptionEntries, selectedExceptionId]);
  const selectedExceptionDetail = selectedException
    ? getExceptionDetail(selectedException.message)
    : null;
  const exceptionStatusValue = latestException ? getExceptionSummary(latestException.message) || "Error" : "None";
  const exceptionStatusTone: BottomStatusTone = latestException ? "error" : "muted";

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger>
        <BottomStatusTriggerButton
          label="Exceptions"
          value={exceptionStatusValue}
          tone={exceptionStatusTone}
        />
      </Popover.Trigger>
      <Popover.Content className="bottom-popover" side="top" align="end" sideOffset={8}>
        <Flex align="center" justify="between" className="popover-title exception-title">
          <Text size="1" weight="medium" className="bottom-popover-heading">
            Exceptions
          </Text>
          <IconButton
            variant="soft"
            color="gray"
            size="1"
            title="Clear exceptions"
            aria-label="Clear exceptions"
            onClick={() => {
              onClearExceptions();
              setSelectedExceptionId(null);
              onOpenChange(false);
            }}
          >
            <X size={12} />
          </IconButton>
        </Flex>
        <Box className="popover-body">
          {exceptionEntries.length > 0 ? (
            <>
              <div className="exception-list">
                {exceptionEntries.map((entry) => {
                  const summary = getExceptionSummary(entry.message);
                  const active = selectedException?.id === entry.id;
                  const interactive = exceptionEntries.length > 1;
                  return (
                    <div
                      key={entry.id}
                      className={`exception-item ${active ? "active" : ""} ${interactive ? "interactive" : ""}`}
                      role={interactive ? "button" : undefined}
                      tabIndex={interactive ? 0 : undefined}
                      onClick={interactive ? () => setSelectedExceptionId(entry.id) : undefined}
                      onKeyDown={
                        interactive
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedExceptionId(entry.id);
                              }
                            }
                          : undefined
                      }
                    >
                      <Text size="2" className="exception-item-summary">
                        {summary}
                      </Text>
                      <Text size="1" color="gray" className="exception-item-time">
                        {formatRelativeTime(entry.timestamp)}
                      </Text>
                    </div>
                  );
                })}
              </div>
              {selectedException && selectedExceptionDetail ? (
                <>
                  <Text size="1" color="gray" className="exception-meta">
                    {formatRelativeTime(selectedException.timestamp)}
                  </Text>
                  <pre className="exception-detail">{selectedExceptionDetail}</pre>
                </>
              ) : null}
            </>
          ) : (
            <Text size="2">No exceptions.</Text>
          )}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
}
