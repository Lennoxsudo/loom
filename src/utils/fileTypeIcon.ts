import {
  getIconForDirectoryPath,
  getIconForFilePath,
  getIconUrlByName,
  isMaterialIconName,
  type MaterialIcon,
} from 'vscode-material-icons';

export const MATERIAL_ICONS_BASE_URL = '/material-icons';

const FILE_NAME_OVERRIDES: Record<string, MaterialIcon> = {
  'cargo.toml': 'rust',
  '.env': 'key',
  '.env.local': 'key',
  '.env.development': 'key',
  '.env.production': 'key',
  '.env.test': 'key',
  '.env.example': 'key',
};

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdc'];
const YAML_EXTENSIONS = ['.yml', '.yaml'];
const JSON_EXTENSIONS = ['.json', '.jsonc', '.json5'];

const WEAK_JSON_ICONS = new Set<MaterialIcon>(['nodejs', 'tsconfig']);
const WEAK_FALLBACK_ICONS = new Set<MaterialIcon>(['file', 'document', 'tune']);

function getBaseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || filePath;
}

function getExtension(lowerName: string): string | null {
  const dot = lowerName.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  return lowerName.slice(dot + 1);
}

function hasExtension(lowerName: string, extensions: string[]): boolean {
  return extensions.some((ext) => lowerName.endsWith(ext));
}

function resolveFileIconName(name: string): MaterialIcon {
  const baseName = getBaseName(name).toLowerCase();
  const lower = name.toLowerCase();

  const fileNameOverride = FILE_NAME_OVERRIDES[baseName];
  if (fileNameOverride) {
    return fileNameOverride;
  }

  if (hasExtension(lower, MARKDOWN_EXTENSIONS)) {
    return 'markdown';
  }

  const defaultIcon = getIconForFilePath(name);

  if (hasExtension(lower, JSON_EXTENSIONS)) {
    if (WEAK_JSON_ICONS.has(defaultIcon)) {
      return 'json';
    }
    return defaultIcon;
  }

  if (hasExtension(lower, YAML_EXTENSIONS) && WEAK_FALLBACK_ICONS.has(defaultIcon)) {
    return 'yaml';
  }

  if (WEAK_FALLBACK_ICONS.has(defaultIcon)) {
    const ext = getExtension(baseName);
    if (ext === 'toml') {
      return 'settings';
    }
    if (ext === 'mdc') {
      return 'markdown';
    }
  }

  return defaultIcon;
}

function resolveDirectoryIconName(name: string, isExpanded: boolean): MaterialIcon {
  const iconName = getIconForDirectoryPath(getBaseName(name));
  if (!isExpanded) {
    return iconName;
  }

  const openName = `${iconName}-open` as MaterialIcon;
  if (isMaterialIconName(openName)) {
    return openName;
  }
  return 'folder-open';
}

export function getFileTypeIconUrl(name: string, isDir: boolean, isExpanded = false): string {
  const iconName = isDir ? resolveDirectoryIconName(name, isExpanded) : resolveFileIconName(name);
  return getIconUrlByName(iconName, MATERIAL_ICONS_BASE_URL);
}

export function getFileTypeIconName(
  name: string,
  isDir: boolean,
  isExpanded = false
): MaterialIcon {
  return isDir ? resolveDirectoryIconName(name, isExpanded) : resolveFileIconName(name);
}
