"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Text } from "@radix-ui/themes";
import CalendarEventBrowser from "@/app/components/calendar/CalendarEventBrowser";
import CalendarDropOverlay from "@/app/components/calendar/CalendarDropOverlay";
import { useCalendarIcsDrop } from "@/app/components/calendar/useCalendarIcsDrop";
import styles from "./page.module.css";

function CalendarWindowContent() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId") ?? "";
  const { dropProps, isDragOver, status, resetStatus } = useCalendarIcsDrop({ accountId });

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
      <div className={styles.detailContainer} {...dropProps}>
        <CalendarEventBrowser accountId={accountId} />
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
