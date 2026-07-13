/**
 * AI工具请求缓存系统
 * 
 * 缓存只读工具调用的结果，减少重复请求，提升性能。
 * 主要用于缓存搜索结果、文件读取等成本较高的操作。
 */

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  expiresAt: number;
  size: number; // 缓存数据大小（字节）
}

interface CacheStats {
  hits: number;
  misses: number;
  totalSize: number;
  entryCount: number;
  evictionCount: number;
  hitRate: number;
}

class ToolRequestCache {
  private cache = new Map<string, CacheEntry>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    totalSize: 0,
    entryCount: 0,
    evictionCount: 0,
    hitRate: 0,
  };
  
  // 默认缓存配置
  private defaultTTL: number = 5 * 60 * 1000; // 5分钟
  private maxEntries: number = 100;
  private maxTotalSize: number = 50 * 1024 * 1024; // 50MB
  
  constructor(options?: {
    defaultTTL?: number;
    maxEntries?: number;
    maxTotalSize?: number;
  }) {
    if (options?.defaultTTL) this.defaultTTL = options.defaultTTL;
    if (options?.maxEntries) this.maxEntries = options.maxEntries;
    if (options?.maxTotalSize) this.maxTotalSize = options.maxTotalSize;
  }
  
  /**
   * 生成缓存键
   */
  private generateKey(toolName: string, params: any): string {
    try {
      // 对参数进行稳定序列化（确保相同参数生成相同键）
      const normalizedParams = this.normalizeParams(params);
      const paramStr = JSON.stringify(normalizedParams, (_key, value) => {
        // 处理特殊类型
        if (value instanceof RegExp) return value.toString();
        if (typeof value === 'function') return undefined; // 函数不缓存
        if (value === undefined) return null; // 统一处理undefined
        return value;
      });
      return `${toolName}:${paramStr}`;
    } catch (error) {
      // 序列化失败时返回简单键（不缓存）
      console.warn('[ToolCache] Failed to generate cache key:', error);
      return `${toolName}:${Date.now()}`; // 使用时间戳确保唯一
    }
  }
  
  /**
   * 规范化参数，确保相同语义的参数生成相同键
   */
  private normalizeParams(params: any): any {
    if (params === null || params === undefined) return params;
    
    if (Array.isArray(params)) {
      return params.map(item => this.normalizeParams(item));
    }
    
    if (typeof params === 'object' && !(params instanceof RegExp)) {
      const normalized: Record<string, any> = {};
      const keys = Object.keys(params).sort(); // 按键名排序确保稳定
      for (const key of keys) {
        const value = params[key];
        if (value !== undefined) { // 排除undefined值
          normalized[key] = this.normalizeParams(value);
        }
      }
      return normalized;
    }
    
    return params;
  }
  
  /**
   * 计算数据大小（粗略估算）
   */
  private calculateSize(data: any): number {
    try {
      const json = JSON.stringify(data);
      return new Blob([json]).size;
    } catch {
      // 如果序列化失败，返回默认大小
      return 1024; // 1KB
    }
  }
  
  /**
   * 清理过期缓存
   */
  private cleanupExpired(): void {
    const now = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
        this.stats.totalSize -= entry.size;
        this.stats.entryCount--;
      }
    }
  }
  
  /**
   * 清理超出限制的缓存（LRU策略）
   */
  private evictIfNeeded(): void {
    this.cleanupExpired();
    
    // 按时间戳排序（最旧的在前）
    const entries = Array.from(this.cache.entries()).sort((a, b) => 
      a[1].timestamp - b[1].timestamp
    );
    
    while (
      (this.stats.entryCount > this.maxEntries || this.stats.totalSize > this.maxTotalSize) &&
      entries.length > 0
    ) {
      const [oldestKey, oldestEntry] = entries.shift()!;
      this.cache.delete(oldestKey);
      this.stats.totalSize -= oldestEntry.size;
      this.stats.entryCount--;
      this.stats.evictionCount++;
    }
  }
  
  /**
   * 获取缓存结果
   */
  get<T = any>(toolName: string, params: any): T | null {
    const key = this.generateKey(toolName, params);
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // 检查是否过期
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.stats.totalSize -= entry.size;
      this.stats.entryCount--;
      this.stats.misses++;
      return null;
    }
    
    this.stats.hits++;
    return entry.data as T;
  }
  
  /**
   * 设置缓存结果
   */
  set<T = any>(toolName: string, params: any, data: T, ttl?: number): void {
    // 不缓存错误结果
    if (data === null || data === undefined) {
      return;
    }
    
    // 不缓存过大的数据
    const size = this.calculateSize(data);
    if (size > 10 * 1024 * 1024) { // 10MB限制
      return;
    }

    // 检查数据是否可缓存（避免缓存函数、Promise等）
    try {
      JSON.stringify(data);
    } catch {
      return;
    }
    
    const key = this.generateKey(toolName, params);
    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiresAt,
      size,
    };
    
    // 先清理空间
    this.evictIfNeeded();
    
    // 检查是否有旧条目
    const oldEntry = this.cache.get(key);
    if (oldEntry) {
      this.stats.totalSize -= oldEntry.size;
    } else {
      this.stats.entryCount++;
    }
    
    // 添加新条目
    this.cache.set(key, entry);
    this.stats.totalSize += size;
  }
  
  /**
   * 删除缓存
   */
  delete(toolName: string, params: any): boolean {
    const key = this.generateKey(toolName, params);
    const entry = this.cache.get(key);
    
    if (entry) {
      this.cache.delete(key);
      this.stats.totalSize -= entry.size;
      this.stats.entryCount--;
      return true;
    }
    
    return false;
  }
  
  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.stats.totalSize = 0;
    this.stats.entryCount = 0;
  }
  
  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100 
      : 0;
    
    return {
      ...this.stats,
      hitRate: parseFloat(hitRate.toFixed(2)),
    };
  }
  
  /**
   * 获取缓存条目列表
   */
  getEntries(): Array<{ key: string; tool: string; age: number; size: number; expiresIn: number }> {
    const now = Date.now();
    return Array.from(this.cache.entries()).map(([key, entry]) => {
      const [toolName] = key.split(':');
      return {
        key,
        tool: toolName,
        age: now - entry.timestamp,
        size: entry.size,
        expiresIn: entry.expiresAt - now,
      };
    });
  }
}

// 全局缓存实例
export const toolCache = new ToolRequestCache();

// 缓存配置：哪些工具可以缓存
const cacheableTools = {
  // New short names - read only tools: cacheable
  'read': true,
  'finfo': true,
  'search': true,
  'sym': true,
  'fetch': true,
  'web_search': true,

  // New short names - write tools: not cacheable
  'write': false,
  'edit': false,
  'term': false,
  'git': false,
  'browser': false,
  'todo': false,
  'ask': false,
  'skill': false,

  // Legacy names (kept for backward compatibility)
  'read_file': true,
  'search_files': true,
  'search_content': true,
  'list_directory': true,
  'get_file_tree': true,
  'get_file_info': true,
  'get_git_diff': true,
  'get_symbol_definition': true,
  'fetch_web_content': true,
  
  'write_file': false,
  'edit_file': false,
  'create_folder': false,
  'move_file': false,
  'delete_file': false,
  'run_command': false,
  'read_terminal_output': false,
  'list_bg_tasks': false,
  'kill_bg_task': false,
  'undo_changes': false,
  'control_browser': false,
  'TodoWrite': false,
  'ask_user_question': false,
  'load_skill': false,
  
  'terminal': false,
  'file_info': true,
};

/**
 * 判断工具是否可缓存
 */
function isToolCacheable(toolName: string): boolean {
  return cacheableTools[toolName as keyof typeof cacheableTools] === true;
}

/**
 * 工具执行结果缓存包装器
 */
export async function executeWithCache<T = any>(
  toolName: string, 
  params: any, 
  executor: () => Promise<T>,
  ttl?: number
): Promise<T> {
  if (!isToolCacheable(toolName)) {
    return executor();
  }
  
  const cached = toolCache.get<T>(toolName, params);
  if (cached !== null) {
    return cached;
  }

  const result = await executor();
  
  // 缓存成功结果
  if (result !== null && result !== undefined) {
    toolCache.set(toolName, params, result, ttl);
  }
  
  return result;
}