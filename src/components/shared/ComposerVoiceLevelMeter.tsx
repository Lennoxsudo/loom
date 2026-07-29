import styles from './ComposerVoiceLevelMeter.module.css';

export interface ComposerVoiceLevelMeterProps {
  levels: number[];
  active: boolean;
  label: string;
}

/** Live mic amplitude bars rendered above the composer while recording. */
export function ComposerVoiceLevelMeter({ levels, active, label }: ComposerVoiceLevelMeterProps) {
  if (!active || levels.length === 0) return null;

  const last = Math.max(1, levels.length - 1);

  return (
    <div className={styles.meter} role="img" aria-label={label}>
      {levels.map((level, index) => {
        const age = index / last; // 0 = oldest (left), 1 = newest (right)
        const height = level <= 0.02 ? 0.03 : Math.max(0.06, Math.min(1, level));
        return (
          <span
            key={index}
            className={styles.bar}
            style={{
              transform: `scaleY(${height})`,
              opacity: level <= 0.02 ? 0.14 + age * 0.16 : 0.35 + age * 0.65,
            }}
          />
        );
      })}
    </div>
  );
}
