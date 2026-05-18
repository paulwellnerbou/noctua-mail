"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Text } from "@radix-ui/themes";
import { postIcsImport } from "@/lib/calendarImportClient";

type LaunchParams = {
  files?: FileSystemFileHandle[];
};

type LaunchQueue = {
  setConsumer: (consumer: (params: LaunchParams) => void) => void;
};

declare global {
  interface Window {
    launchQueue?: LaunchQueue;
  }
}

type ImportState =
  | { kind: "waiting" }
  | { kind: "importing"; filename: string }
  | { kind: "error"; message: string };

async function readFile(handle: FileSystemFileHandle): Promise<{ name: string; text: string }> {
  const file = await handle.getFile();
  const text = await file.text();
  return { name: file.name, text };
}

export default function CalendarImportPage() {
  const router = useRouter();
  const [state, setState] = useState<ImportState>({ kind: "waiting" });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const queue = window.launchQueue;
    if (!queue) {
      setState({
        kind: "error",
        message: "This browser does not support PWA file handling. Drop the .ics onto the calendar inside the app instead."
      });
      return;
    }
    queue.setConsumer(async (params) => {
      const files = params.files ?? [];
      if (files.length === 0) {
        setState({ kind: "error", message: "No file was provided." });
        return;
      }
      try {
        const errors: string[] = [];
        // Count imported events (across all files) rather than imported
        // files, so a single-file ICS whose response contained N upserts
        // and M failures reports honestly (e.g. "Imported 4 events with
        // 1 failure") instead of misleading "Imported 1/1".
        let importedEventCount = 0;
        for (const handle of files) {
          const { name, text } = await readFile(handle);
          setState({ kind: "importing", filename: name });
          if (!text.trim()) {
            errors.push(`${name} is empty`);
            continue;
          }
          const result = await postIcsImport(text);
          if (result.ok) {
            importedEventCount += result.imports?.length ?? result.eventUids?.length ?? 0;
            if (result.failures) {
              for (const f of result.failures) errors.push(`${name}: ${f.message}`);
            }
          } else {
            errors.push(`${name}: ${result.message ?? "Import failed"}`);
          }
        }
        // Only redirect to the calendar if every file imported cleanly; if
        // anything failed, stay on this page so the user actually sees the
        // error message instead of losing it under a navigation.
        if (importedEventCount > 0 && errors.length === 0) {
          router.replace("/?openCalendar=1");
        } else if (importedEventCount > 0) {
          const eventLabel = importedEventCount === 1 ? "1 event" : `${importedEventCount} events`;
          const failureLabel = errors.length === 1 ? "1 failure" : `${errors.length} failures`;
          setState({
            kind: "error",
            message: `Imported ${eventLabel} with ${failureLabel}: ${errors.join("; ")}`
          });
        } else {
          setState({ kind: "error", message: errors[0] ?? "Import failed" });
        }
      } catch (error) {
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Failed to read file"
        });
      }
    });
  }, [router]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", padding: "2rem" }}>
      <div style={{ textAlign: "center", maxWidth: 480 }}>
        {state.kind === "waiting" && <Text size="3" color="gray">Waiting for calendar file…</Text>}
        {state.kind === "importing" && (
          <Text size="3" color="gray">Importing {state.filename}…</Text>
        )}
        {state.kind === "error" && (
          <Text size="3" color="red">{state.message}</Text>
        )}
      </div>
    </div>
  );
}
