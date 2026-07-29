import type { ComposerVoiceState } from '../../hooks/useComposerVoiceInput';
import { MicIcon } from './Icons';
import styles from './ComposerVoiceButton.module.css';

export interface ComposerVoiceButtonProps {
  state: ComposerVoiceState;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}

/** Minimalist 5-bar SVG equalizer shown while transcribing. */
function SonicWave() {
  return (
    <span className={styles.sonic} aria-hidden="true">
      <svg className={styles.sonicSvg} viewBox="0 0 42 16" fill="none">
        <g>
          <path className={`${styles.eqBar} ${styles.b1}`} d="M9 1 L9 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path className={`${styles.eqBar} ${styles.b2}`} d="M15 1 L15 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path className={`${styles.eqBar} ${styles.b3}`} d="M21 1 L21 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path className={`${styles.eqBar} ${styles.b4}`} d="M27 1 L27 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path className={`${styles.eqBar} ${styles.b5}`} d="M33 1 L33 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </svg>
    </span>
  );
}

export function ComposerVoiceButton({
  state,
  title,
  disabled = false,
  onClick,
}: ComposerVoiceButtonProps) {
  const isRecording = state === 'recording';
  const isTranscribing = state === 'transcribing';

  return (
    <button
      type="button"
      className={`${styles.button} ${
        isRecording ? styles.recording : isTranscribing ? styles.transcribing : ''
      }`}
      onClick={onClick}
      disabled={disabled || isTranscribing}
      title={title}
      aria-label={title}
      aria-pressed={isRecording}
      aria-busy={isTranscribing}
    >
      {isTranscribing ? (
        <SonicWave />
      ) : (
        <span className={styles.iconWrap} aria-hidden="true">
          <MicIcon size={14} />
          {isRecording ? (
            <>
              <span className={`${styles.pulseRing} ${styles.pulseRingOuter}`} />
              <span className={styles.pulseRing} />
            </>
          ) : null}
        </span>
      )}
    </button>
  );
}
