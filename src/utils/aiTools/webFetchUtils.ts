/**
 * WebFetch URL 验证与权限检查工具
 *
 * 参照 Claude Code WebFetch 实现。
 */

import { isPreapprovedUrl } from './webFetchPreapproved';

// ── URL 验证 ──

interface UrlValidationResult {
  valid: boolean;
  error?: string;
  upgradedUrl?: string; // HTTP→HTTPS 升级后的 URL
}

/**
 * 验证 URL 是否可用于 fetch_web_content。
 *
 * 规则：
 *   - 能被 new URL() 解析
 *   - 长度 ≤ 2000 字符
 *   - 协议为 http 或 https
 *   - hostname 至少有 2 个点分部分
 *   - URL 中不含用户名/密码
 *   - HTTP 自动升级为 HTTPS
 */
export function validateFetchUrl(url: string): UrlValidationResult {
  // 长度检查
  if (url.length > 2000) {
    return { valid: false, error: `URL 长度超过限制 (2000 字符)` };
  }

  // 解析检查
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { valid: false, error: `无效的 URL: "${url}"` };
  }

  // 协议检查
  const scheme = parsedUrl.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') {
    return { valid: false, error: `不支持的协议: ${parsedUrl.protocol}。仅支持 http/https。` };
  }

  // Hostname 公网可解析（至少 2 个点分部分）
  const hostname = parsedUrl.hostname;
  if (hostname.split('.').length < 2) {
    return { valid: false, error: `主机名不是有效的公网域名: ${hostname}` };
  }

  // 检查用户名/密码
  if (parsedUrl.username || parsedUrl.password) {
    return { valid: false, error: 'URL 不能包含用户名或密码' };
  }

  // HTTP 自动升级为 HTTPS
  let upgradedUrl: string | undefined;
  if (parsedUrl.protocol === 'http:') {
    upgradedUrl = url.replace(/^http:\/\//i, 'https://');
  }

  return { valid: true, upgradedUrl };
}

// ── 权限模型 ──

type PermissionDecision = 'allow' | 'deny' | 'ask';

interface WebFetchRules {
  allowed: string[]; // 格式: "domain:example.com"
  denied: string[];  // 格式: "domain:example.com"
}

const RULES_STORAGE_KEY = 'web-fetch-rules';

function loadRules(): WebFetchRules {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        allowed: Array.isArray(parsed.allowed) ? parsed.allowed : [],
        denied: Array.isArray(parsed.denied) ? parsed.denied : [],
      };
    }
  } catch {
    // ignore
  }
  return { allowed: [], denied: [] };
}

function getDomainKey(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    return `domain:${parsedUrl.hostname}`;
  } catch {
    return null;
  }
}

/**
 * 检查给定 URL 的访问权限。
 *
 * 优先级：
 *   1. 预批准白名单 → allow
 *   2. deny 规则 → deny
 *   3. allow 规则 → allow
 *   4. 默认 → allow（Loom 当前无交互式权限 UI，暂不阻塞）
 */
export function checkFetchPermission(url: string): PermissionDecision {
  // 1. 预批准白名单
  if (isPreapprovedUrl(url)) {
    return 'allow';
  }

  const rules = loadRules();
  const domainKey = getDomainKey(url);
  if (!domainKey) return 'allow';

  // 2. deny 规则
  if (rules.denied.includes(domainKey)) {
    return 'deny';
  }

  // 3. allow 规则
  if (rules.allowed.includes(domainKey)) {
    return 'allow';
  }

  // 4. 默认 allow（Claude Code 默认 ask，但我们没有交互式权限 UI）
  return 'allow';
}
