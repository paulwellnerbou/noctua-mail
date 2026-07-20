import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
 * DOM and can no longer be measured; re-measuring therefore clears the cache
 * rather than updating it in place, so the full set is remeasured together.
 */
export default function OverflowTabsList({ tabs, activeValue, onSelect, overflowLabel = "More tabs" }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);

  const allMeasured = tabs.every((tab) => widths[tab.value] !== undefined);

  // Until every width is known the full set renders, so one pass measures them all.
  // Measuring only the rendered subset would strand stale widths on menu tabs.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || allMeasured) return;

    const measured: Record<string, number> = {};
    list.querySelectorAll<HTMLElement>("[data-tab-value]").forEach((trigger) => {
      const value = trigger.dataset.tabValue;
      // offsetWidth, not getBoundingClientRect: the dialog's open animation scales
      // the modal, which would make every tab measure narrower than it lays out.
      const width = trigger.offsetWidth;
      if (value && width > 0) measured[value] = width;
    });

    // Measuring the DOM and storing the result is the point of this effect; the
    // identity check below keeps it from looping when nothing actually changed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidths((current) => {
      const next = { ...current, ...measured };
      const changed = Object.keys(next).some((value) => next[value] !== current[value]);
      return changed ? next : current;
    });
  }, [allMeasured, tabs]);

  // Triggers do not shrink, so a resize changes the budget but never the widths.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const update = () => setAvailableWidth(list.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  // Widths measured in a fallback font are wrong once the real font swaps in, and
  // that swap never resizes the list. Drop them so the full set is measured again.
  useEffect(() => {
    if (!document.fonts || document.fonts.status === "loaded") return;

    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) setWidths({});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleCount = useMemo(() => {
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
  }, [allMeasured, availableWidth, tabs, widths]);

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
