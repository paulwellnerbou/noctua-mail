import type { TopicColor } from "@/lib/data";
import { TOPIC_COLORS } from "@/lib/data";
import styles from "./TopicColorPicker.module.css";

type TopicColorPickerProps = {
  value: TopicColor | null;
  onChange: (color: TopicColor | null) => void;
  swatchSize?: "sm" | "md";
};

export default function TopicColorPicker({ value, onChange, swatchSize = "md" }: TopicColorPickerProps) {
  return (
    <div className={`${styles.swatches} ${swatchSize === "sm" ? styles.swatchesSm : ""}`}>
      <button
        type="button"
        className={`${styles.swatch} ${styles.swatchNone} ${value === null ? styles.swatchSelected : ""}`}
        onClick={() => onChange(null)}
        aria-label="No color"
        title="No color"
      />
      {TOPIC_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`${styles.swatch} ${value === color ? styles.swatchSelected : ""}`}
          style={{ "--swatch-color": `var(--${color}-9)` } as React.CSSProperties}
          onClick={() => onChange(color)}
          aria-label={color}
          title={color}
        />
      ))}
    </div>
  );
}
