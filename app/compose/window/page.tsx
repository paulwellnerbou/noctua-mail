"use client";

import { Suspense, useEffect, useState } from "react";
import type React from "react";
import { useSearchParams } from "next/navigation";
import { Text } from "@radix-ui/themes";
import DetachedComposeWindowClient from "@/app/components/mailclient/composition/DetachedComposeWindowClient";
import { formatComposePageTitle } from "@/lib/appBranding";
import {
  buildDetachedComposeHandoffStorageKey,
  readDetachedComposeHandoff,
  type DetachedComposeHandoff
} from "@/lib/ui/detachedComposeHandoff";
import styles from "./page.module.css";

function ComposeWindowContent() {
  const searchParams = useSearchParams();
  const handoffId = searchParams.get("handoff")?.trim() ?? "";
  const [handoff, setHandoff] = useState<DetachedComposeHandoff | null>(null);
  const [missingHandoff, setMissingHandoff] = useState(false);

  useEffect(() => {
    document.title = formatComposePageTitle();
  }, []);

  useEffect(() => {
    if (!handoffId || (handoff && handoff.status !== "preparing")) return;
    let active = true;
    const readHandoff = () => {
      if (!active) return;
      try {
        const next = readDetachedComposeHandoff(handoffId);
        if (next) setHandoff(next);
      } catch {
        setMissingHandoff(true);
      }
    };
    readHandoff();
    const interval = window.setInterval(readHandoff, 100);
    const storageKey = buildDetachedComposeHandoffStorageKey(handoffId);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) readHandoff();
    };
    window.addEventListener("storage", handleStorage);
    const missingTimer = window.setTimeout(
      () => setMissingHandoff(true),
      handoff?.status === "preparing" ? 60_000 : 10_000
    );
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
      window.clearTimeout(missingTimer);
    };
  }, [handoff, handoffId]);

  if (!handoffId) {
    return <ComposeWindowState color="red">Missing compose handoff.</ComposeWindowState>;
  }
  if (missingHandoff && (!handoff || handoff.status === "preparing")) {
    return (
      <ComposeWindowState color="red">
        The composer session could not be prepared. Your message remains in the mail window.
      </ComposeWindowState>
    );
  }
  if (!handoff) {
    return <ComposeWindowState color="gray">Preparing draft…</ComposeWindowState>;
  }
  if (handoff.status === "error") {
    return <ComposeWindowState color="red">{handoff.message}</ComposeWindowState>;
  }
  if (handoff.status === "preparing") {
    return <ComposeWindowState color="gray">Saving draft before opening…</ComposeWindowState>;
  }
  return (
    <div className={styles.page}>
      <DetachedComposeWindowClient handoffId={handoffId} handoff={handoff} />
    </div>
  );
}

function ComposeWindowState({
  color,
  children
}: {
  color: "gray" | "red";
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.state}>
        <Text size="2" color={color}>{children}</Text>
      </div>
    </div>
  );
}

export default function ComposeWindowPage() {
  return (
    <Suspense fallback={<ComposeWindowState color="gray">Opening composer…</ComposeWindowState>}>
      <ComposeWindowContent />
    </Suspense>
  );
}
