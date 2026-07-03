import { describe, expect, it, afterEach } from 'vitest';
import {
  getCbmStorageCache,
  hasCbmStorageFetchAttempted,
  resetCbmStorageCacheForTests,
  setCbmStorageCache,
} from '../cbmStorageCache';

describe('cbmStorageCache', () => {
  afterEach(() => {
    resetCbmStorageCacheForTests();
  });

  it('starts empty and marks fetch attempted after cache is set', () => {
    expect(getCbmStorageCache()).toBeNull();
    expect(hasCbmStorageFetchAttempted()).toBe(false);

    setCbmStorageCache({ cacheDir: 'C:\\cache', totalBytes: 1024 });

    expect(getCbmStorageCache()).toEqual({ cacheDir: 'C:\\cache', totalBytes: 1024 });
    expect(hasCbmStorageFetchAttempted()).toBe(true);
  });
});
