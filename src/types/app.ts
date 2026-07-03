/**
 * Application type definitions
 */

/**
 * Editor group ID (supports up to 2 split groups)
 */
export type EditorGroupId = 'group-1' | 'group-2';

/**
 * Split direction for editor groups
 */
export type SplitDirection = 'row' | 'column';

/**
 * Editor group state containing tabs and active file
 */
export interface EditorGroupState {
  /** Unique group identifier */
  id: EditorGroupId;
  /** List of file paths in this group */
  tabPaths: string[];
  /** Currently active file path */
  activePath: string | null;
}

/**
 * Open file types supported by the editor
 */
export type OpenFile =
  | {
      /** Text file (code, markdown, etc.) */
      kind: 'text';
      /** Absolute file path */
      path: string;
      /** File name */
      name: string;
      /** File content */
      content: string;
      /** Whether file has unsaved changes */
      isDirty: boolean;
      /** Whether file has been deleted from disk */
      isDeleted?: boolean;
    }
  | {
      /** Image file */
      kind: 'image';
      /** Absolute file path */
      path: string;
      /** File name */
      name: string;
      /** Image source URL (data URL or file URL) */
      src: string;
      /** Always false for images */
      isDirty: false;
      /** Whether file has been deleted from disk */
      isDeleted?: boolean;
    }
  | {
      /** Settings panel */
      kind: 'settings';
      /** Settings path identifier */
      path: string;
      /** Display name */
      name: string;
      /** Always false for settings */
      isDirty: false;
    }
  | {
      /** Agent panel */
      kind: 'agent';
      /** Agent path identifier */
      path: string;
      /** Display name */
      name: string;
      /** Always false for agent */
      isDirty: false;
    }
  | {
      /** Browser panel */
      kind: 'browser';
      /** Browser path identifier */
      path: string;
      /** Display name */
      name: string;
      /** URL being displayed */
      url: string;
      /** Always false for browser */
      isDirty: false;
    }
  | {
      /** Side-by-side diff in main editor area */
      kind: 'diff';
      /** Unique tab path (e.g. __diff__/...) */
      path: string;
      /** Tab title */
      name: string;
      originalContent: string;
      modifiedContent: string;
      /** Monaco language id */
      language: string;
      /** Original pane label (e.g. HEAD) */
      leftLabel: string;
      /** Modified pane label (e.g. working tree) */
      rightLabel: string;
      isDirty: false;
    };

/**
 * Map of file paths to open files
 */
export type OpenFilesByPath = Record<string, OpenFile>;

/**
 * Tab ID prefix for identifying tab elements
 */
const TAB_ID_PREFIX = 'tab|';

/**
 * Tab bar ID prefix for identifying tab bar elements
 */
const TAB_BAR_ID_PREFIX = 'tabbar|';

/**
 * Split zone ID prefix for identifying split drop zones
 */
const SPLIT_ZONE_ID_PREFIX = 'splitzone|';

/**
 * Right split zone ID
 */
export const SPLIT_ZONE_RIGHT_ID = `${SPLIT_ZONE_ID_PREFIX}right`;

/**
 * Down split zone ID
 */
export const SPLIT_ZONE_DOWN_ID = `${SPLIT_ZONE_ID_PREFIX}down`;

/**
 * Left open zone ID
 */
export const OPEN_ZONE_LEFT_ID = `${SPLIT_ZONE_ID_PREFIX}open-left`;

/**
 * Editor tab bar height in pixels
 */
export const EDITOR_TAB_BAR_HEIGHT_PX = 30;

/**
 * Chat attach zone ID for drag and drop
 */
export const CHAT_ATTACH_ZONE_ID = 'chat-attach-zone';

/**
 * Event name for chat file attachment
 */
export const CHAT_ATTACH_FILE_EVENT = 'loom:chat-attach-file';

/**
 * Event name for new conversation
 */
export const CHAT_NEW_CONVERSATION_EVENT = 'loom:chat-new-conversation';

/**
 * Generate a tab ID from group ID and file path
 * @param groupId - Editor group ID
 * @param filePath - File path
 * @returns Tab ID string
 */
export function makeTabId(groupId: EditorGroupId, filePath: string): string {
  return `${TAB_ID_PREFIX}${groupId}|${filePath}`;
}

/**
 * Generate a tab bar ID from group ID
 * @param groupId - Editor group ID
 * @returns Tab bar ID string
 */
export function makeTabBarId(groupId: EditorGroupId): string {
  return `${TAB_BAR_ID_PREFIX}${groupId}`;
}

/**
 * Check if an ID is a tab ID
 * @param id - ID to check
 * @returns Whether the ID is a tab ID
 */
export function isTabId(id: string): boolean {
  return id.startsWith(TAB_ID_PREFIX);
}

/**
 * Check if an ID is a tab bar ID
 * @param id - ID to check
 * @returns Whether the ID is a tab bar ID
 */
export function isTabBarId(id: string): boolean {
  return id.startsWith(TAB_BAR_ID_PREFIX);
}

/**
 * Parse a tab ID into group ID and file path
 * @param id - Tab ID to parse
 * @returns Object containing groupId and filePath
 */
export function parseTabId(id: string): { groupId: EditorGroupId; filePath: string } {
  const parts = id.split('|');
  const groupIdRaw = parts[1];
  const filePath = parts.slice(2).join('|');

  const groupId: EditorGroupId = groupIdRaw === 'group-2' ? 'group-2' : 'group-1';
  return { groupId, filePath };
}

/**
 * Parse a tab bar ID into group ID
 * @param id - Tab bar ID to parse
 * @returns Object containing groupId
 */
export function parseTabBarId(id: string): { groupId: EditorGroupId } {
  const parts = id.split('|');
  const groupIdRaw = parts[1];
  const groupId: EditorGroupId = groupIdRaw === 'group-2' ? 'group-2' : 'group-1';
  return { groupId };
}
