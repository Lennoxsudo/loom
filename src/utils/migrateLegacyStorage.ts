const LEGACY_COLON_PREFIX = 'aiasprrato:';
const LEGACY_DOT_PREFIX = 'aiasprrato.';
const NEW_COLON_PREFIX = 'loom:';
const NEW_DOT_PREFIX = 'loom.';
const MIGRATION_FLAG = 'loom.migrated';

function toNewStorageKey(legacyKey: string): string {
  if (legacyKey.startsWith(LEGACY_COLON_PREFIX)) {
    return `${NEW_COLON_PREFIX}${legacyKey.slice(LEGACY_COLON_PREFIX.length)}`;
  }
  if (legacyKey.startsWith(LEGACY_DOT_PREFIX)) {
    return `${NEW_DOT_PREFIX}${legacyKey.slice(LEGACY_DOT_PREFIX.length)}`;
  }
  return legacyKey;
}

/** Copy localStorage entries from the pre-rename Aiasprrato keys to Loom keys. */
export function migrateLegacyStorageKeys(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  if (localStorage.getItem(MIGRATION_FLAG) != null) {
    return;
  }

  const legacyKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (key.startsWith(LEGACY_COLON_PREFIX) || key.startsWith(LEGACY_DOT_PREFIX)) {
      legacyKeys.push(key);
    }
  }

  for (const legacyKey of legacyKeys) {
    const newKey = toNewStorageKey(legacyKey);
    if (localStorage.getItem(newKey) != null) {
      continue;
    }
    const value = localStorage.getItem(legacyKey);
    if (value != null) {
      localStorage.setItem(newKey, value);
    }
  }

  localStorage.setItem(MIGRATION_FLAG, 'v1');
}
