"use client";

import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

export type BottomStatusTone = "normal" | "muted" | "error";

type BottomStatusSectionProps = {
  label: string;
  value: string;
  tone?: BottomStatusTone;
  alignRight?: boolean;
  wide?: boolean;
};

type BottomStatusTriggerButtonProps = BottomStatusSectionProps &
  ComponentPropsWithoutRef<"button">;

function getBottomStatusValueClassName(tone: BottomStatusTone) {
  return tone === "error" ? "bottom-error" : tone === "muted" ? "bottom-muted" : "bottom-item";
}

function getBottomStatusSectionClassName(alignRight: boolean, wide: boolean, interactive: boolean) {
  return [
    "bottom-section",
    alignRight ? "bottom-right" : "",
    wide ? "bottom-wide" : "",
    interactive ? "bottom-status-trigger" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

export function BottomStatusSection({
  label,
  value,
  tone = "normal",
  alignRight = false,
  wide = false
}: BottomStatusSectionProps) {
  const valueClassName = getBottomStatusValueClassName(tone);
  const className = getBottomStatusSectionClassName(alignRight, wide, false);

  return (
    <div className={className}>
      <span className="bottom-label">{label}</span>
      <span className={valueClassName} title={value}>
        {value}
      </span>
    </div>
  );
}

export const BottomStatusTriggerButton = forwardRef<HTMLButtonElement, BottomStatusTriggerButtonProps>(
  function BottomStatusTriggerButton(
    { label, value, tone = "normal", alignRight = false, wide = false, className, type, ...buttonProps },
    ref
  ) {
    const triggerClassName = [
      getBottomStatusSectionClassName(alignRight, wide, true),
      className
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={triggerClassName}
        {...buttonProps}
      >
        <span className="bottom-label">{label}</span>
        <span className={getBottomStatusValueClassName(tone)} title={value}>
          {value}
        </span>
      </button>
    );
  }
);
