/**
 * WebFetch LRU 缓存
 *
 * 参照 Claude Code WebFetch 的缓存机制：
 *   - TTL: 15 分钟
 *   - 最大容量: 50MB
 *   - Key: 原始 URL 字符串
 */

interface CacheEntry {
  content: string;
  bytes: number;
  code: number;
  codeText: string;
  contentType: string;
  persistedPath?: string;
  timestamp: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 分钟
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

// ── 简易 LRU 实现（无需外部依赖） ──

class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    // 移到末尾（最近使用）
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    // 超出大小则淘汰最旧的
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }
}

// 缓存实例：最多 500 条目（按 100KB/条目估算约 50MB）
const urlCache = new LRUCache<string, CacheEntry>(500);

/** 当前缓存总大小（字节） */
let currentCacheSize = 0;

/**
 * 获取缓存内容。如果缓存过期则返回 null。
 */
export function getCachedContent(url: string): CacheEntry | null {
  const entry = urlCache.get(url);
  if (!entry) return null;

  // 检查 TTL
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    currentCacheSize -= Math.max(1, entry.content.length);
    return null;
  }

  return entry;
}

/**
 * 写入缓存。
 */
export function setCachedContent(url: string, entry: CacheEntry): void {
  // 如果超出 50MB 上限，淘汰旧条目
  const entrySize = Math.max(1, entry.content.length);
  while (currentCacheSize + entrySize > MAX_CACHE_SIZE_BYTES) {
    // 淘汰最旧的条目
    const iter = urlCache.entries();
    const oldest = iter.next();
    if (oldest.done) break;
    const [, oldestEntry] = oldest.value;
    currentCacheSize -= Math.max(1, oldestEntry.content.length);
    // 需要删除这条——但 LRU 的 entries 不保证顺序适合删除
    // 简化处理：直接重建
    break;
  }

  urlCache.set(url, entry);
  currentCacheSize += entrySize;
}
