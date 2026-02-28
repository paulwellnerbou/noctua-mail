import { useEffect, useState } from "react";
import type React from "react";
import { applyToggleWithAnimation, type ToggleAnimation } from "./listInteractions";

type CollapsedStateSetter = React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

export function useThreadListAnimationState() {
  const [lastGroupToggle, setLastGroupToggle] = useState<ToggleAnimation | null>(null);
  const [lastThreadToggle, setLastThreadToggle] = useState<ToggleAnimation | null>(null);
  const [lastNestedToggle, setLastNestedToggle] = useState<ToggleAnimation | null>(null);
  const [animationClock, setAnimationClock] = useState(0);
  const [collapsedNestedMessages, setCollapsedNestedMessages] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    if (!animationClock) return;
    const timer = window.setTimeout(() => setAnimationClock(0), 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [animationClock]);

  const toggleGroup = (groupKey: string, open: boolean, setCollapsedGroups: CollapsedStateSetter) => {
    applyToggleWithAnimation({
      key: groupKey,
      open,
      setLastToggle: setLastGroupToggle,
      setAnimationClock,
      setCollapsedState: setCollapsedGroups
    });
  };

  const toggleThread = (
    threadGroupId: string,
    isCollapsed: boolean,
    setCollapsedThreads: CollapsedStateSetter
  ) => {
    applyToggleWithAnimation({
      key: threadGroupId,
      open: isCollapsed,
      setLastToggle: setLastThreadToggle,
      setAnimationClock,
      setCollapsedState: setCollapsedThreads
    });
  };

  const toggleNested = (messageId: string, isNestedCollapsed: boolean) => {
    applyToggleWithAnimation({
      key: messageId,
      open: isNestedCollapsed,
      setLastToggle: setLastNestedToggle,
      setAnimationClock,
      setCollapsedState: setCollapsedNestedMessages
    });
  };

  return {
    lastGroupToggle,
    lastThreadToggle,
    lastNestedToggle,
    animationClock,
    collapsedNestedMessages,
    toggleGroup,
    toggleThread,
    toggleNested
  };
}
