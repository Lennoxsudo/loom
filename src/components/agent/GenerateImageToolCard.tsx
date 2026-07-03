import { memo, useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useNotification } from '../../contexts/NotificationContext';
import { useTranslation } from '../../i18n';
import { getImageAspectRatioStyle, openGeneratedImageInEditor } from '../../utils/imageGenConfig';
import styles from './GenerateImageToolCard.module.css';
import { formatToolDisplayName } from './toolResultLayout';

type ViewportPhase = 'pending' | 'revealing' | 'done';

function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.6" fill="currentColor" />
      <path
        d="M7 17l4.2-4.2a1.2 1.2 0 0 1 1.7 0L17 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 12.5 16.5 10h2.5v9H5v-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const GenerateImageGlassViewport = memo(function GenerateImageGlassViewport({
  aspectRatio,
  prompt,
  hint,
  pendingLabel,
  imageSrc,
  absolutePath,
  fileName,
  isPending,
  showPrompt,
  multi,
  openHint,
  onOpenImage,
}: {
  aspectRatio: string;
  prompt?: string;
  hint: string;
  pendingLabel: string;
  imageSrc?: string;
  absolutePath?: string;
  fileName?: string;
  isPending: boolean;
  showPrompt: boolean;
  multi: boolean;
  openHint?: string;
  onOpenImage?: (absolutePath: string) => void;
}) {
  const [phase, setPhase] = useState<ViewportPhase>(() => {
    if (isPending) return 'pending';
    if (imageSrc) return 'pending';
    return 'done';
  });

  useEffect(() => {
    if (isPending) {
      setPhase('pending');
    }
  }, [isPending]);

  const startReveal = useCallback(() => {
    if (!isPending && imageSrc) {
      setPhase('revealing');
    }
  }, [imageSrc, isPending]);

  useEffect(() => {
    if (!isPending && imageSrc && phase === 'pending') {
      const img = new Image();
      img.onload = () => startReveal();
      img.onerror = () => setPhase('done');
      img.src = imageSrc;
      if (img.complete) {
        startReveal();
      }
    }
  }, [imageSrc, isPending, phase, startReveal]);

  const handleImageLoad = () => {
    if (!isPending && imageSrc) {
      startReveal();
    }
  };

  const handleGlassTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName !== 'opacity') return;
    if (phase === 'revealing') {
      setPhase('done');
    }
  };

  const showGlass = phase !== 'done';
  const showImage = Boolean(imageSrc);
  const isDone = phase === 'done';
  const canOpen = isDone && Boolean(absolutePath) && Boolean(onOpenImage);

  const handleOpenImage = () => {
    if (canOpen && absolutePath) {
      onOpenImage?.(absolutePath);
    }
  };

  const handleImageKeyDown = (event: KeyboardEvent<HTMLImageElement>) => {
    if (!canOpen) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpenImage();
    }
  };

  return (
    <div
      className={multi ? styles.viewportWrapMulti : styles.viewportWrap}
      data-testid="image-glass-viewport"
    >
      <div
        className={`${styles.viewport} ${isDone ? styles.viewportDone : ''}`}
        style={isDone ? undefined : { aspectRatio }}
      >
        {showImage ? (
          <img
            src={imageSrc}
            alt={fileName || 'Generated image'}
            className={
              isDone
                ? `${styles.imageDone}${canOpen ? ` ${styles.imageClickable}` : ''}`
                : `${styles.imageLayer} ${phase !== 'pending' ? styles.imageVisible : ''}`
            }
            onLoad={handleImageLoad}
            onClick={canOpen ? handleOpenImage : undefined}
            onKeyDown={canOpen ? handleImageKeyDown : undefined}
            role={canOpen ? 'button' : undefined}
            tabIndex={canOpen ? 0 : undefined}
            title={canOpen ? openHint : undefined}
            data-testid={canOpen ? 'generated-image-open' : undefined}
          />
        ) : null}

        {showGlass ? (
          <div
            className={`${styles.glassLayer} ${phase === 'revealing' ? styles.glassRevealing : ''}`}
            onTransitionEnd={handleGlassTransitionEnd}
          >
            <div className={styles.glassNoise} aria-hidden="true" />
            <div className={styles.glassShimmer} aria-hidden="true" />
            <div className={styles.centerContent}>
              {isPending ? (
                <>
                  <div className={styles.sparkles} aria-hidden="true">
                    <span className={styles.sparkle} />
                    <span className={styles.sparkle} />
                    <span className={styles.sparkle} />
                  </div>
                  <p className={styles.status}>
                    {pendingLabel}
                    <span className={styles.dots} aria-hidden="true">
                      <span className={styles.dot} />
                      <span className={styles.dot} />
                      <span className={styles.dot} />
                    </span>
                  </p>
                  <p className={styles.hint}>
                    {showPrompt && prompt?.trim() ? `"${prompt.trim()}"` : hint}
                  </p>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {isDone && fileName ? (
          <div className={styles.fileNameOverlay} title={fileName}>
            {fileName}
          </div>
        ) : null}
      </div>
    </div>
  );
});

export const GenerateImageToolCard = memo(function GenerateImageToolCard({
  dense,
  prompt,
  size,
  imagePaths = [],
  imageCount = 1,
  isPending,
  isError,
  errorText,
}: {
  dense?: boolean;
  prompt?: string;
  size?: string;
  imagePaths?: string[];
  imageCount?: number;
  isPending: boolean;
  isError?: boolean;
  errorText?: string;
}) {
  const t = useTranslation();
  const { showWarning } = useNotification();
  const pendingLabel = t.agentInternal.generateImagePending;
  const hint = t.agentInternal.generateImageHint;
  const running = t.agentInternal.generateImageRunning;
  const openHint = t.agentInternal.generateImageOpenHint;
  const completed = t.common.completed;
  const aspectRatio = getImageAspectRatioStyle(size);

  const handleOpenImage = useCallback(
    (absolutePath: string) => {
      void openGeneratedImageInEditor(absolutePath, {
        onMissing: () => showWarning(t.agentInternal.generateImageFileMissing),
      });
    },
    [showWarning, t.agentInternal.generateImageFileMissing]
  );

  const viewportCount = isPending
    ? Math.min(Math.max(imageCount, 1), 4)
    : Math.max(imagePaths.length, 1);

  const badgeClass = isError
    ? styles.badgeError
    : isPending
      ? styles.badge
      : `${styles.badge} ${styles.badgeDone}`;

  const badgeText = isError ? t.common.failed : isPending ? running : completed;

  return (
    <div className={styles.card} style={{ marginBottom: dense ? '6px' : '8px' }}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.iconWrap}>
            <ImageIcon />
          </div>
          <span className={styles.title}>{formatToolDisplayName('generate_image')}</span>
        </div>
        <span className={badgeClass}>{badgeText}</span>
      </div>

      {!isError ? (
        <div className={`${styles.body} ${!isPending ? styles.bodyDone : ''}`}>
          <div className={styles.viewportGrid}>
            {Array.from({ length: viewportCount }, (_, index) => {
              const imagePath = imagePaths[index];
              if (!isPending && !imagePath) return null;
              const fileName = imagePath?.replace(/^.*[\\/]/, '');
              return (
                <GenerateImageGlassViewport
                  key={imagePath || `pending-${index}`}
                  aspectRatio={aspectRatio}
                  prompt={prompt}
                  hint={hint}
                  pendingLabel={pendingLabel}
                  imageSrc={imagePath ? convertFileSrc(imagePath) : undefined}
                  absolutePath={imagePath}
                  fileName={fileName}
                  isPending={isPending}
                  showPrompt={index === 0}
                  multi={viewportCount > 1}
                  openHint={openHint}
                  onOpenImage={handleOpenImage}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {isError && errorText ? <p className={styles.errorText}>{errorText}</p> : null}
    </div>
  );
});
