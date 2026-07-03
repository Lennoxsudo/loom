export const BACKGROUND_MAX_DEPTH = 5;

export function canSpawnSubagent(depth: number, background: boolean): boolean {
  if (background && depth >= BACKGROUND_MAX_DEPTH) return false;
  return true;
}

export function canForkAtDepth(depth: number, spawnMode?: string): boolean {
  if (spawnMode === 'fork' && depth > 0) return false;
  return true;
}
