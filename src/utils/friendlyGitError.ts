const WINDOWS_RESERVED_STEMS = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

export function isWindowsReservedFilename(name: string): boolean {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const stem = (base.split('.')[0] ?? base).toUpperCase();
  return WINDOWS_RESERVED_STEMS.has(stem);
}

export function extractInvalidPathNames(raw: string): string[] {
  const names: string[] = [];
  const pattern = /invalid path '([^']+)'/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    names.push(match[1]);
  }
  return names;
}

type GitReservedPathErrorI18n = {
  invalidPathReservedNames: string;
};

export function formatFriendlyGitError(raw: string, g: GitReservedPathErrorI18n): string {
  const invalidNames = extractInvalidPathNames(raw);
  const reserved = invalidNames.filter(isWindowsReservedFilename);
  if (reserved.length > 0) {
    return g.invalidPathReservedNames.replace('{names}', reserved.join(', '));
  }
  return raw.trim();
}

export function buildWindowsReservedDeleteCommand(repoPath: string, fileName: string): string {
  const normalized = repoPath.replace(/\//g, '\\').replace(/\\+$/, '');
  return `del \\\\?\\${normalized}\\${fileName}`;
}
