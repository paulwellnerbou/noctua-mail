import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, Tabs } from "@radix-ui/themes";

export type OverflowTabItem = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  tabs: OverflowTabItem[];
  activeValue: string;
  onSelect: (value: string) => void;
  overflowLabel?: string;
};

// Kept in sync with the width of `.settings-tabs-overflow` in globals.css.
const OVERFLOW_TRIGGER_WIDTH = 32;

/**
 * Tab list that moves the tabs which do not fit into a trailing "more" menu.
 * Widths are cached per tab value because a tab pushed into the menu leaves the
 * DOM and can no longer be measured.
 */
export default function OverflowTabsList({ tabs, activeValue, onSelect, overflowLabel = "More tabs" }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const sync = () => {
      const measured: Record<string, number> = {};
      list.querySelectorAll<HTMLElement>("[data-tab-value]").forEach((trigger) => {
        const value = trigger.dataset.tabValue;
        // offsetWidth, not getBoundingClientRect: the dialog's open animation scales
        // the modal, which would make every tab measure narrower than it lays out.
        const width = trigger.offsetWidth;
        if (value && width > 0) measured[value] = width;
      });

      setWidths((current) => {
        const next = { ...current, ...measured };
        const changed = Object.keys(next).some((value) => next[value] !== current[value]);
        return changed ? next : current;
      });
      setAvailableWidth(list.clientWidth);
    };

    sync();
    // The first pass can measure fallback-font widths, which never resize the list.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) sync();
    });

    const observer = new ResizeObserver(sync);
    observer.observe(list);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [tabs]);

  const visibleCount = useMemo(() => {
    const allMeasured = tabs.every((tab) => widths[tab.value] !== undefined);
    if (!allMeasured || availableWidth === null) return tabs.length;

    const total = tabs.reduce((sum, tab) => sum + widths[tab.value], 0);
    if (total <= availableWidth) return tabs.length;

    const budget = availableWidth - OVERFLOW_TRIGGER_WIDTH;
    let used = 0;
    let count = 0;
    for (const tab of tabs) {
      used += widths[tab.value];
      if (used > budget) break;
      count += 1;
    }
    return Math.max(count, 1);
  }, [availableWidth, tabs, widths]);

  const visibleTabs = tabs.slice(0, visibleCount);
  const overflowTabs = tabs.slice(visibleCount);
  const activeInOverflow = overflowTabs.some((tab) => tab.value === activeValue);

  return (
    <Tabs.List ref={listRef} className="settings-tabs-list">
      {visibleTabs.map((tab) => (
        <Tabs.Trigger key={tab.value} value={tab.value} disabled={tab.disabled} data-tab-value={tab.value}>
          {tab.label}
        </Tabs.Trigger>
      ))}
      {overflowTabs.length > 0 && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <button
              type="button"
              className="settings-tabs-overflow"
              aria-label={overflowLabel}
              title={overflowLabel}
              data-active={activeInOverflow ? "" : undefined}
            >
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.RadioGroup value={activeValue} onValueChange={onSelect}>
              {overflowTabs.map((tab) => (
                <DropdownMenu.RadioItem key={tab.value} value={tab.value} disabled={tab.disabled}>
                  {tab.label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      )}
    </Tabs.List>
  );
}
