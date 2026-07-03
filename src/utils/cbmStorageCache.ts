export type CbmStorageCacheEntry = {
  cacheDir: string;
  totalBytes: number;
};

let cachedStorageInfo: CbmStorageCacheEntry | null = null;
let storageFetchAttempted = false;

export function getCbmStorageCache(): CbmStorageCacheEntry | null {
  return cachedStorageInfo;
}

export function hasCbmStorageFetchAttempted(): boolean {
  return storageFetchAttempted;
}

export function setCbmStorageCache(info: CbmStorageCacheEntry | null): void {
  cachedStorageInfo = info;
  storageFetchAttempted = true;
}

export function resetCbmStorageCacheForTests(): void {
  cachedStorageInfo = null;
  storageFetchAttempted = false;
}
