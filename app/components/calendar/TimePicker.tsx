"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Clock } from "lucide-react";
import { IconButton, Popover, TextField } from "@radix-ui/themes";
import styles from "./TimePicker.module.css";

type Props = {
  /** Current time as "HH:MM" (24h). Empty string when unset. */
  value: string;
  /** Called with a normalised "HH:MM" string, or "" if the user cleared the field. */
  onChange: (value: string) => void;
  /** Step in minutes for the popover suggestion list. Typing accepts any minute. */
  stepMinutes?: number;
  /**
   * Optional reference time in minutes-from-midnight. When provided, each row in
   * the popover shows the duration relative to this reference (used for the end
   * picker, where the reference is the current start time).
   */
  referenceMinutes?: number;
  disabled?: boolean;
  ariaLabel?: string;
};

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]?\d)$/;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatHhMm(minutes: number) {
  const safe = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
}

function toMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Tolerant parser for typed input. Accepts shapes like:
 *   "9"     → "09:00"
 *   "9:5"   → "09:05"
 *   "0930"  → "09:30"
 *   "1430"  → "14:30"
 *   "14:3"  → "14:03"
 * Returns null when the value cannot be coerced into a valid 24h time.
 */
function parseLooseTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const colonMatch = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
  if (colonMatch) {
    const h = Number(colonMatch[1]);
    const m = Number(colonMatch[2]);
    if (h < 24 && m < 60) return `${pad2(h)}:${pad2(m)}`;
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    if (trimmed.length <= 2) {
      const h = Number(trimmed);
      if (h < 24) return `${pad2(h)}:00`;
      return null;
    }
    if (trimmed.length === 3 || trimmed.length === 4) {
      const h = Number(trimmed.slice(0, trimmed.length - 2));
      const m = Number(trimmed.slice(-2));
      if (h < 24 && m < 60) return `${pad2(h)}:${pad2(m)}`;
      return null;
    }
  }

  return null;
}

function formatDurationLabel(deltaMinutes: number): string {
  if (deltaMinutes <= 0) return "";
  const hours = Math.floor(deltaMinutes / 60);
  const mins = deltaMinutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return hours === 1 ? "1 h" : `${hours} h`;
  return `${hours} h ${mins} min`;
}

export default function TimePicker({
  value,
  onChange,
  stepMinutes = 5,
  referenceMinutes,
  disabled = false,
  ariaLabel
}: Props) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the visible text in sync when the upstream value changes (e.g. after
  // the start handler shifts the end). Skip while the input is focused — a
  // value-prop change arriving mid-typing would otherwise wipe what the user
  // has typed (e.g. "14:3" → parent commits a shifted end → "11:30").
  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) return;
    setDraft(value);
  }, [value]);

  const options = useMemo(() => {
    const stepsPerDay = Math.floor((24 * 60) / stepMinutes);
    return Array.from({ length: stepsPerDay }, (_, idx) => idx * stepMinutes);
  }, [stepMinutes]);

  const valueMinutes = toMinutes(value);

  const commit = (raw: string) => {
    if (!raw.trim()) {
      onChange("");
      setDraft("");
      return;
    }
    const parsed = parseLooseTime(raw);
    if (parsed === null) {
      // Invalid — revert to the last good value.
      setDraft(value);
      return;
    }
    setDraft(parsed);
    if (parsed !== value) onChange(parsed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(draft);
      (event.target as HTMLInputElement).blur();
    } else if (event.key === "Escape") {
      setDraft(value);
      (event.target as HTMLInputElement).blur();
    }
  };

  // Scroll the popover to the currently-selected (or nearest) entry on open.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (!node) return;
    const target = valueMinutes ?? referenceMinutes ?? 9 * 60;
    const nearestIdx = options.reduce((best, mins, idx) => {
      return Math.abs(mins - target) < Math.abs(options[best] - target) ? idx : best;
    }, 0);
    const child = node.children[nearestIdx] as HTMLElement | undefined;
    if (child) {
      // Centre the nearest option in the list so neighbours are visible.
      child.scrollIntoView({ block: "center" });
    }
  }, [open, options, valueMinutes, referenceMinutes]);

  return (
    <div className={styles.root}>
      <TextField.Root
        ref={inputRef}
        className={styles.input}
        value={draft}
        placeholder="HH:MM"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={ariaLabel}
        inputMode="numeric"
      >
        <TextField.Slot side="right">
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger>
              <IconButton
                type="button"
                size="1"
                variant="ghost"
                color="gray"
                disabled={disabled}
                aria-label="Open time picker"
                className={styles.triggerButton}
              >
                <Clock size={14} />
              </IconButton>
            </Popover.Trigger>
            <Popover.Content className={styles.popoverContent} size="1">
              <div ref={listRef} className={styles.optionList} role="listbox">
                {options.map((minutes) => {
                  const label = formatHhMm(minutes);
                  const isSelected = valueMinutes === minutes;
                  const durationLabel =
                    referenceMinutes !== undefined
                      ? formatDurationLabel(minutes - referenceMinutes)
                      : "";
                  return (
                    <button
                      key={minutes}
                      type="button"
                      className={styles.option}
                      data-selected={isSelected ? "true" : "false"}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setDraft(label);
                        if (label !== value) onChange(label);
                        setOpen(false);
                      }}
                    >
                      <span>{label}</span>
                      {durationLabel && (
                        <span className={styles.optionDuration}>{durationLabel}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Popover.Content>
          </Popover.Root>
        </TextField.Slot>
      </TextField.Root>
    </div>
  );
}
