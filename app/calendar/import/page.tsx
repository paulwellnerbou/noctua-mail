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
        let lastError: string | null = null;
        let importedAny = false;
        for (const handle of files) {
          const { name, text } = await readFile(handle);
          setState({ kind: "importing", filename: name });
          if (!text.trim()) {
            lastError = `${name} is empty`;
            continue;
          }
          const result = await postIcsImport(text);
          if (result.ok) {
            importedAny = true;
          } else {
            lastError = `${name}: ${result.message ?? "Import failed"}`;
          }
        }
        if (importedAny) {
          router.replace("/?openCalendar=1");
        } else {
          setState({ kind: "error", message: lastError ?? "Import failed" });
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
