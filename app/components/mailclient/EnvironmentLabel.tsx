import styles from "./EnvironmentLabel.module.css";

type EnvironmentLabelProps = {
  label: string;
  className?: string;
};

export default function EnvironmentLabel({ label, className }: EnvironmentLabelProps) {
  const text = label.trim();
  if (!text) return null;

  const width = Math.max(42, Math.min(150, text.length * 7 + 22));
  const height = 20;

  return (
    <span className={`${styles.root}${className ? ` ${className}` : ""}`} title={text}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Environment ${text}`}
      >
        <rect
          x="1.5"
          y="1.5"
          width={width - 3}
          height={height - 3}
          rx="5.5"
          ry="5.5"
          className={styles.body}
        />
        <text
          x={width / 2}
          y={height / 2 + 0.5}
          className={styles.text}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {text}
        </text>
      </svg>
    </span>
  );
}
