import { useState, type CSSProperties } from 'react';
import { useTranslation } from '../i18n';

const IMG_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  backgroundColor: '#0b0b0b',
};

const CONTAINER_STYLE: CSSProperties = {
  height: '100%',
  width: '100%',
  position: 'relative',
  overflow: 'hidden',
  backgroundColor: '#111',
};

export default function ImagePreview({
  filePath,
  src,
  name,
}: {
  filePath: string;
  src: string;
  name: string;
}) {
  const t = useTranslation();
  const [loadError, setLoadError] = useState<string | null>(null);

  return (
    <div style={CONTAINER_STYLE}>
      {loadError ? (
        <div style={{ padding: 16, color: '#cccccc' }}>
          <div style={{ marginBottom: 8 }}>{t.image.loadFailed}</div>
          <div style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}>{filePath}</div>
        </div>
      ) : (
        <img
          src={src}
          alt={name}
          style={IMG_STYLE}
          onError={() => setLoadError('error')}
          draggable={false}
        />
      )}
    </div>
  );
}
