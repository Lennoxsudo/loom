import { memo } from 'react';
import { getFileTypeIconUrl } from '../../utils/fileTypeIcon';
import styles from './FileTypeIcon.module.css';

interface FileTypeIconProps {
  name: string;
  isDir?: boolean;
  isExpanded?: boolean;
  size?: number;
  className?: string;
}

export const FileTypeIcon = memo(function FileTypeIcon({
  name,
  isDir = false,
  isExpanded = false,
  size = 16,
  className,
}: FileTypeIconProps) {
  const src = getFileTypeIconUrl(name, isDir, isExpanded);

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={[styles.icon, className].filter(Boolean).join(' ')}
      draggable={false}
    />
  );
});
