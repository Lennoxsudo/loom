/**
 * 参数解析工具模块
 * 
 * 本模块提供了工具参数解析和路径处理的辅助函数：
 * - 路径解析和规范化
 * - 类型转换辅助函数
 * - JSON 参数提取和解析
 * 
 * @module aiTools/argsParser
 */

/**
 * 将相对路径解析为绝对路径
 * 
 * 支持 Windows 驱动器路径、UNC 路径和 Unix 风格绝对路径。
 * 
 * @param p - 要检查的路径字符串
 * @returns 如果是绝对路径返回 true
 * 
 * @example
 * ```typescript
 * isAbsolutePath('C:\\Users\\test'); // true
 * isAbsolutePath('/home/user'); // true
 * isAbsolutePath('relative/path'); // false
 * ```
 */
function isAbsolutePath(p: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith('\\\\')) return true;
  if (p.startsWith('/')) return true;
  return false;
}

/**
 * 将相对路径解析为绝对路径
 * 
 * 如果路径已经是绝对路径，则原样返回。
 * 否则将相对路径与基础目录拼接。
 * 
 * @param path - 要解析的路径
 * @param baseDir - 基础目录（可选）
 * @returns 解析后的绝对路径
 * 
 * @example
 * ```typescript
 * resolvePathWithBaseDir('src/file.ts', '/project'); // '/project/src/file.ts'
 * resolvePathWithBaseDir('/absolute/path', '/project'); // '/absolute/path'
 * ```
 */
export function resolvePathWithBaseDir(path: string, baseDir?: string): string {
  if (!baseDir) return path;
  const p = path.trim();
  if (!p) return path;
  if (isAbsolutePath(p)) return p;

  const base = baseDir.replace(/[\\/]+$/g, '');
  const rel = p.replace(/^[\\/]+/g, '');
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base}${sep}${rel}`;
}

/**
 * 尝试提取并修复不完整的 JSON
 * 
 * 从文本中提取 JSON 片段，如果 JSON 不完整则尝试自动补全。
 * 
 * @param source - 源文本
 * @returns 提取并可能修复后的 JSON 字符串，如果无法提取则返回 null
 */
function extractAndFixJson(source: string): string | null {
  const s = source.trim();
  
  // 检查是否有 Markdown 代码块
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const input = (fenceMatch?.[1] ?? s).trim();

  // 查找 JSON 开始位置
  const start = input.search(/[[{]/);
  if (start < 0) return null;

  // 尝试找到完整的 JSON（已闭合）
  let depth = 0;
  let inString = false;
  let escaped = false;
  let endPos = -1;

  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        endPos = i;
        break;
      }
    }
  }

  // 如果找到完整 JSON，直接返回
  if (endPos >= 0) {
    return input.slice(start, endPos + 1);
  }

  // JSON 不完整，尝试修复
  // 提取从开始位置到字符串末尾的内容
  let jsonPart = input.slice(start);
  
  // 统计未闭合的括号
  let braceDepth = 0;
  let bracketDepth = 0;
  inString = false;
  escaped = false;

  for (let i = 0; i < jsonPart.length; i++) {
    const ch = jsonPart[i];
    
    if (escaped) {
      escaped = false;
      continue;
    }
    
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
  }

  // 如果在字符串中间截断，需要先关闭字符串
  if (inString) {
    jsonPart += '"';
  }

  // 补全缺失的括号
  while (bracketDepth > 0) {
    jsonPart += ']';
    bracketDepth--;
  }
  while (braceDepth > 0) {
    jsonPart += '}';
    braceDepth--;
  }

  return jsonPart;
}

/**
 * 解析工具参数字符串
 * 
 * 支持多种格式：
 * - 标准 JSON 格式
 * - 不完整的 JSON（自动补全闭合括号）
 * - Markdown 代码块包裹的 JSON
 * - 键值对格式 (key=value)
 * 
 * @param argsStr - 参数字符串
 * @returns 解析后的参数对象
 * @throws 如果无法解析则抛出错误
 * 
 * @example
 * ```typescript
 * parseToolArguments('{"path": "/test"}'); // { path: '/test' }
 * parseToolArguments('path=/test max=10'); // { path: '/test', max: '10' }
 * ```
 */
export function parseToolArguments(argsStr: string): unknown {
  const s = argsStr?.trim() ?? '';

  if (s === '' || s === 'null' || s === 'undefined') {
    return {};
  }

  try {
    return JSON.parse(s);
  } catch {
    // Continue to other parsing methods
  }

  const extracted = extractAndFixJson(s);
  if (extracted) {
    try {
      return JSON.parse(extracted);
    } catch {
      // Continue to key-value format
    }
  }

  if (s.includes('=') && !s.startsWith('{') && !s.startsWith('[')) {
    const obj: Record<string, string> = {};
    const pairs = s.split(/\s+/);
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx);
        let value = pair.slice(eqIdx + 1);
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        obj[key] = value;
      }
    }
    if (Object.keys(obj).length > 0) {
      return obj;
    }
  }

  return {};
}

/**
 * Sanitize a string for safe Tauri IPC transmission.
 *
 * JS strings can contain lone surrogates (e.g., `\uD800` without a following
 * low surrogate). When Tauri's IPC serializes these via JSON.stringify, they
 * become `\uD800` in the JSON — but serde_json on the Rust side rejects lone
 * surrogates as invalid Unicode ("unexpected end of hex escape").
 *
 * This function replaces any lone surrogates with the Unicode replacement
 * character (U+FFFD), ensuring the string survives round-trip through JSON.
 */
export function sanitizeStringForIpc(str: string): string {
  // Fast path: no surrogates at all
  if (!str || str.length < 2) return str;

  let result = '';
  let i = 0;
  let modified = false;

  while (i < str.length) {
    const code = str.charCodeAt(i);

    // High surrogate (0xD800–0xDBFF) must be followed by low surrogate
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < str.length) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          // Valid surrogate pair — keep both
          result += str[i] + str[i + 1];
          i += 2;
          continue;
        }
      }
      // Lone high surrogate — replace with U+FFFD
      result += '\uFFFD';
      modified = true;
      i += 1;
      continue;
    }

    // Lone low surrogate (0xDC00–0xDFFF) — replace with U+FFFD
    if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\uFFFD';
      modified = true;
      i += 1;
      continue;
    }

    result += str[i];
    i += 1;
  }

  return modified ? result : str;
}

/**
 * Recursively sanitize all string values in a message object for safe IPC.
 *
 * Walks the object tree and applies `sanitizeStringForIpc` to every string
 * value, including nested objects and arrays.
 */
export function sanitizeMessagesForIpc<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeStringForIpc(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeMessagesForIpc) as T;
  }

  if (value !== null && typeof value === 'object') {
    const result = {} as Record<string, unknown>;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = sanitizeMessagesForIpc(v);
    }
    return result as T;
  }

  return value;
}
