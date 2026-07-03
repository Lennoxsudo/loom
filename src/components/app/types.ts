import type { EditorGroupId } from '../../types/app';

export type PendingSearchJump = {
  groupId: EditorGroupId;
  filePath: string;
  line: number;
  column: number;
  matchLen: number;
} | null;
