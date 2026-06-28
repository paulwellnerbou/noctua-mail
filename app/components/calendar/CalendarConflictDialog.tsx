"use client";

import { Badge, Button, Dialog, Flex, Separator, Text } from "@radix-ui/themes";
import CalendarDiffRows from "./CalendarDiffRows";
import type { CalendarEventConflictItem } from "./useCalendarConflicts";
import styles from "./EventDetailView.module.css";

function formatChangedAt(ms: number | null, timeZone?: string | null): string {
  if (!ms) return "unknown time";
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timeZone || undefined
    });
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export type CalendarConflictDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: CalendarEventConflictItem[];
  resolvingEventId: string | null;
  onResolve: (eventId: string, resolution: "local" | "remote") => void | Promise<void>;
};

/**
 * Resolution UI for CalDAV write-back conflicts. For each conflicting event it
 * shows, side by side, what the user changed locally and what changed on the
 * server (each with its change time), rendered with the same field-level diff
 * as incoming invite updates, then lets the user keep one side.
 */
export default function CalendarConflictDialog({
  open,
  onOpenChange,
  conflicts,
  resolvingEventId,
  onResolve
}: CalendarConflictDialogProps) {
  const busy = resolvingEventId !== null;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onOpenChange(false);
      }}
    >
      <Dialog.Content size="3" className={styles.responseDialog}>
        <Flex direction="column" gap="3">
          <Dialog.Title size="4">Calendar sync conflicts</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            These events changed both here and on the server since the last sync. Choose which
            version to keep for each.
          </Dialog.Description>

          {conflicts.map((conflict, index) => {
            const resolving = resolvingEventId === conflict.eventId;
            return (
              <div key={conflict.eventId}>
                {index > 0 && <Separator size="4" my="3" />}
                <Flex direction="column" gap="3">
                  <Text size="3" weight="medium">
                    {conflict.summary || "Untitled Event"}
                  </Text>

                  <Flex direction="column" gap="1">
                    <Flex align="center" gap="2">
                      <Badge color="blue" variant="soft">
                        Your changes
                      </Badge>
                      <Text size="1" color="gray">
                        edited {formatChangedAt(conflict.localChangedAtMs, conflict.timeZone)}
                      </Text>
                    </Flex>
                    <CalendarDiffRows
                      diff={conflict.localDiff}
                      timeZone={conflict.timeZone ?? undefined}
                      allDay={conflict.allDay}
                    />
                  </Flex>

                  <Flex direction="column" gap="1">
                    <Flex align="center" gap="2">
                      <Badge color="amber" variant="soft">
                        Server changes
                      </Badge>
                      <Text size="1" color="gray">
                        updated {formatChangedAt(conflict.remoteChangedAtMs, conflict.timeZone)}
                      </Text>
                    </Flex>
                    <CalendarDiffRows
                      diff={conflict.remoteDiff}
                      timeZone={conflict.timeZone ?? undefined}
                      allDay={conflict.allDay}
                    />
                  </Flex>

                  <Flex gap="2" justify="end">
                    <Button
                      size="1"
                      variant="soft"
                      color="amber"
                      disabled={busy}
                      onClick={() => void onResolve(conflict.eventId, "remote")}
                    >
                      {resolving ? "Applying…" : "Use server version"}
                    </Button>
                    <Button
                      size="1"
                      color="blue"
                      disabled={busy}
                      onClick={() => void onResolve(conflict.eventId, "local")}
                    >
                      {resolving ? "Applying…" : "Keep my version"}
                    </Button>
                  </Flex>
                </Flex>
              </div>
            );
          })}

          <Flex justify="end">
            <Button variant="soft" color="gray" disabled={busy} onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
