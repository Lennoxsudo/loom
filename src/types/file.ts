/**
 * File operation type definitions
 */

/**
 * Item being created (file or folder)
 */
export interface CreatingItem {
  /** Type of item being created */
  type: 'file' | 'folder';
  /** Parent directory path */
  parentPath: string;
}

/**
 * Item being renamed inline in file tree
 */
export interface RenamingItem {
  /** Absolute path of the node being renamed */
  path: string;
  /** Current display name */
  name: string;
  /** Whether the target is a directory */
  isDir: boolean;
}
