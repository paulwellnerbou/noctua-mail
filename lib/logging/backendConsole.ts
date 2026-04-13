import { formatWithOptions } from "node:util";

const TIMESTAMPED_METHOD_STREAMS = {
  debug: "stdout",
  info: "stdout",
  log: "stdout",
  warn: "stderr",
  error: "stderr"
} as const;

type TimestampedConsoleMethod = keyof typeof TIMESTAMPED_METHOD_STREAMS;

function padNumber(value: number, width = 2) {
  return String(value).padStart(width, "0");
}

export function formatBackendLogTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hours = padNumber(date.getHours());
  const minutes = padNumber(date.getMinutes());
  const seconds = padNumber(date.getSeconds());
  const milliseconds = padNumber(date.getMilliseconds(), 3);

  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = padNumber(Math.floor(absoluteOffsetMinutes / 60));
  const offsetRemainderMinutes = padNumber(absoluteOffsetMinutes % 60);

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds} ${offsetSign}${offsetHours}:${offsetRemainderMinutes}`;
}

export function prefixLogLines(message: string, timestamp: string) {
  return message.split(/\r?\n/).map((line) => `[${timestamp}] ${line}`).join("\n");
}

export function installBackendConsoleTimestamps() {
  if (process.env.NODE_ENV === "test") return;

  const globalState = globalThis as typeof globalThis & {
    __noctuaBackendConsoleTimestampsInstalled?: boolean;
  };
  if (globalState.__noctuaBackendConsoleTimestampsInstalled) return;
  globalState.__noctuaBackendConsoleTimestampsInstalled = true;

  const patchedConsole = console as Record<TimestampedConsoleMethod, (...args: unknown[]) => void>;

  for (const [method, streamName] of Object.entries(TIMESTAMPED_METHOD_STREAMS) as [
    TimestampedConsoleMethod,
    "stdout" | "stderr"
  ][]) {
    const stream = process[streamName];
    patchedConsole[method] = (...args: unknown[]) => {
      const rendered = formatWithOptions({ colors: stream.isTTY }, ...args);
      const timestamp = formatBackendLogTimestamp(new Date());
      void stream.write(`${prefixLogLines(rendered, timestamp)}\n`);
    };
  }
}
