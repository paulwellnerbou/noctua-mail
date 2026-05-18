"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type FullCalendar from "@fullcalendar/react";
import { DropdownMenu, IconButton, Text } from "@radix-ui/themes";
import { MoreVertical } from "lucide-react";
import CalendarEventBrowser from "@/app/components/calendar/CalendarEventBrowser";
import CalendarDropOverlay from "@/app/components/calendar/CalendarDropOverlay";
import { useCalendarIcsDrop } from "@/app/components/calendar/useCalendarIcsDrop";
import { buildAccountCalendarRecomputeRelationsPath } from "@/lib/accountApiPaths";
import styles from "./page.module.css";

function CalendarWindowContent() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId") ?? "";
  const calendarRef = useRef<FullCalendar>(null);
  const [recomputingRelations, setRecomputingRelations] = useState(false);
  const handleImported = useCallback(() => {
    calendarRef.current?.getApi().refetchEvents();
  }, []);
  const { dropProps, isDragOver, status, resetStatus } = useCalendarIcsDrop({
    accountId,
    onImported: handleImported
  });

  const handleRecomputeRelations = async () => {
    if (recomputingRelations) return;
    setRecomputingRelations(true);
    try {
      const res = await fetch(buildAccountCalendarRecomputeRelationsPath(accountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      if (data.ok) {
        calendarRef.current?.getApi().refetchEvents();
      } else {
        console.error("[Calendar] Recompute relations failed:", data);
      }
    } catch (err) {
      console.error("[Calendar] Recompute relations error:", err);
    } finally {
      setRecomputingRelations(false);
    }
  };

  if (!accountId) {
    return (
      <div className={styles.page}>
        <div className={styles.state}>
          <Text size="2" color="red">Missing accountId parameter.</Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton variant="ghost" color="gray" size="1" title="Calendar options" aria-label="Calendar options">
              <MoreVertical size={14} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" sideOffset={4}>
            <DropdownMenu.Item
              disabled={recomputingRelations}
              onSelect={() => void handleRecomputeRelations()}
            >
              Recompute event associations
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
      <div className={styles.detailContainer} {...dropProps}>
        <CalendarEventBrowser
          accountId={accountId}
          calendarRef={calendarRef}
        />
        <CalendarDropOverlay isDragOver={isDragOver} status={status} onResetStatus={resetStatus} />
      </div>
    </div>
  );
}

export default function CalendarWindowPage() {
  return (
    <Suspense fallback={<div className={styles.page}><div className={styles.state}><Text size="2" color="gray">Loading…</Text></div></div>}>
      <CalendarWindowContent />
    </Suspense>
  );
}
