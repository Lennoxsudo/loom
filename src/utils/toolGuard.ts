import type { ToolCall, ToolResult } from '../features/agent-engine';
import { isKnownToolName } from '../features/agent-engine';
import type { AgentAccessMode } from '../types/settings';

const MERGED_TOOL_RESOLVE: Record<string, string> = {
  term: 'run_command',
  terminal: 'run_command',
  finfo: 'get_file_tree',
  file_info: 'get_file_tree',
  search: 'search_content',
  git: 'get_git_diff',
};

function resolveToUnderlyingTool(toolName: string): string {
  return MERGED_TOOL_RESOLVE[toolName] ?? toolName;
}

interface RateLimitConfig {
  windowMs: number;
  maxCalls: number;
}

interface ResourceLimits {
  maxFileReads: number;
  maxTotalBytes: number;
  maxCommandExecutions: number;
  maxConcurrentCalls: number;
}

interface DangerousToolRule {
  name: string;
  patterns?: RegExp[];
  requiresConfirmation?: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
}

interface AccessModePolicy {
  confirmCommands: boolean;
  confirmWrites: boolean;
  blockCriticalPatterns: boolean;
}

interface GuardPolicy {
  enabled: boolean;
  rateLimits: {
    global: RateLimitConfig;
    tools: Record<string, RateLimitConfig>;
  };
  resourceLimits: ResourceLimits;
  dangerousTools: DangerousToolRule[];
  accessModePolicies: Record<AgentAccessMode, AccessModePolicy>;
  blockedCommands: string[];
  allowedPaths?: string[];
  blockedPaths?: string[];
  maxRepetitions: number;
  noProgressThreshold: number;
  enableLogging: boolean;
  logRetentionMs: number;
}

const DEFAULT_ACCESS_MODE_POLICIES: Record<AgentAccessMode, AccessModePolicy> = {
  read_only: {
    confirmCommands: false,
    confirmWrites: false,
    blockCriticalPatterns: false,
  },
  auto: {
    confirmCommands: false,
    confirmWrites: false,
    blockCriticalPatterns: false,
  },
  full_access: {
    confirmCommands: false,
    confirmWrites: false,
    blockCriticalPatterns: false,
  },
};

export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  enabled: true,
  rateLimits: {
    global: { windowMs: 60000, maxCalls: 100 },
    tools: {
      read: { windowMs: 60000, maxCalls: 50 },
      read_file: { windowMs: 60000, maxCalls: 50 },
      write: { windowMs: 60000, maxCalls: 30 },
      write_file: { windowMs: 60000, maxCalls: 30 },
      edit: { windowMs: 60000, maxCalls: 30 },
      edit_file: { windowMs: 60000, maxCalls: 30 },
      delete_file: { windowMs: 60000, maxCalls: 10 },
      move_file: { windowMs: 60000, maxCalls: 15 },
      run_command: { windowMs: 60000, maxCalls: 40 },
      get_git_diff: { windowMs: 60000, maxCalls: 30 },
      search_files: { windowMs: 60000, maxCalls: 40 },
      search_content: { windowMs: 60000, maxCalls: 30 },
      create_terminal: { windowMs: 60000, maxCalls: 10 },
      term: { windowMs: 60000, maxCalls: 40 },
      terminal: { windowMs: 60000, maxCalls: 40 },
      finfo: { windowMs: 60000, maxCalls: 50 },
      file_info: { windowMs: 60000, maxCalls: 50 },
      search: { windowMs: 60000, maxCalls: 40 },
      git: { windowMs: 60000, maxCalls: 30 },
    },
  },
  resourceLimits: {
    maxFileReads: 200,
    maxTotalBytes: 50 * 1024 * 1024,
    maxCommandExecutions: 100,
    maxConcurrentCalls: 5,
  },
  dangerousTools: [
    { name: 'delete_file', riskLevel: 'high', requiresConfirmation: true, description: '删除文件' },
    {
      name: 'move_file',
      riskLevel: 'medium',
      requiresConfirmation: false,
      description: '移动文件',
    },
    {
      name: 'run_command',
      riskLevel: 'medium',
      requiresConfirmation: false,
      description: '执行命令',
    },
    { name: 'term', riskLevel: 'medium', requiresConfirmation: false, description: '终端操作' },
    { name: 'terminal', riskLevel: 'medium', requiresConfirmation: false, description: '终端操作' },
    { name: 'write', riskLevel: 'low', requiresConfirmation: false, description: '写入文件' },
    { name: 'write_file', riskLevel: 'low', requiresConfirmation: false, description: '写入文件' },
    { name: 'edit', riskLevel: 'low', requiresConfirmation: false, description: '编辑文件' },
    { name: 'edit_file', riskLevel: 'low', requiresConfirmation: false, description: '编辑文件' },
    {
      name: 'run_command',
      patterns: [
        /rm\s+-rf/,
        /del\s+\/[sS]/,
        /format\s+/,
        /mkfs/,
        /dd\s+if=/,
        />\s*\/dev\//,
        /sudo\s+/,
        /chmod\s+777/,
        /curl.*\|\s*bash/,
        /wget.*\|\s*bash/,
        /git\s+push/,
      ],
      riskLevel: 'critical',
      requiresConfirmation: true,
      description: '危险命令模式',
    },
    {
      name: 'term',
      patterns: [
        /rm\s+-rf/,
        /del\s+\/[sS]/,
        /format\s+/,
        /mkfs/,
        /dd\s+if=/,
        />\s*\/dev\//,
        /sudo\s+/,
        /chmod\s+777/,
        /curl.*\|\s*bash/,
        /wget.*\|\s*bash/,
        /git\s+push/,
      ],
      riskLevel: 'critical',
      requiresConfirmation: true,
      description: '危险命令模式',
    },
    {
      name: 'terminal',
      patterns: [
        /rm\s+-rf/,
        /del\s+\/[sS]/,
        /format\s+/,
        /mkfs/,
        /dd\s+if=/,
        />\s*\/dev\//,
        /sudo\s+/,
        /chmod\s+777/,
        /curl.*\|\s*bash/,
        /wget.*\|\s*bash/,
        /git\s+push/,
      ],
      riskLevel: 'critical',
      requiresConfirmation: true,
      description: '危险命令模式',
    },
  ],
  accessModePolicies: DEFAULT_ACCESS_MODE_POLICIES,
  blockedCommands: ['rm -rf /', 'format c:', 'del /s /q', ':(){ :|:& };:'],
  maxRepetitions: 3,
  noProgressThreshold: 2,
  enableLogging: true,
  logRetentionMs: 30 * 60 * 1000,
};

function matchDangerousRules(
  toolName: string,
  args: Record<string, unknown>,
  policy: GuardPolicy
): DangerousToolRule[] {
  const matches: DangerousToolRule[] = [];
  for (const rule of policy.dangerousTools) {
    if (rule.name !== toolName) continue;
    if (rule.patterns) {
      const commandStr = typeof args.command === 'string' ? args.command : '';
      if (rule.patterns.some((pattern) => pattern.test(commandStr))) {
        matches.push(rule);
      }
    } else {
      matches.push(rule);
    }
  }
  return matches;
}

export function requiresConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  accessMode: AgentAccessMode,
  policy: GuardPolicy = DEFAULT_GUARD_POLICY
): boolean {
  // full_access 模式：全部放行，不做任何审批拦截
  if (accessMode === 'full_access') {
    return false;
  }

  // Critical dangerous patterns require confirmation in non-full_access modes.
  // This ensures commands like `rm -rf /` and `git push` can never execute
  // without explicit user approval in read_only / auto modes.
  const criticalRules = matchDangerousRules(toolName, args, policy);
  const patternRules = criticalRules.filter((rule) => rule.patterns && rule.patterns.length > 0);
  if (patternRules.length > 0) {
    return true;
  }

  const resolvedName = resolveToUnderlyingTool(toolName);
  const explicitConfirmRules = criticalRules.filter((rule) => rule.requiresConfirmation);
  if (explicitConfirmRules.length > 0) {
    return true;
  }

  const modePolicy = policy.accessModePolicies[accessMode];
  if (
    modePolicy.confirmWrites &&
    ['write', 'write_file', 'edit', 'edit_file', 'delete_file', 'move_file'].includes(resolvedName)
  ) {
    return true;
  }

  if (
    modePolicy.confirmCommands &&
    (['run_command', 'term', 'terminal', 'create_terminal'].includes(resolvedName) ||
      (resolvedName === 'graph_index' &&
        (args.action === 'index' || args.action === undefined || args.action === '')))
  ) {
    return true;
  }

  return false;
}

export class SlidingWindowRateLimiter {
  private timestamps: number[] = [];

  constructor(
    private windowMs: number,
    private maxCalls: number
  ) {}

  tryAcquire(): { allowed: boolean; currentCount: number; resetIn: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    this.timestamps = this.timestamps.filter((ts) => ts > windowStart);
    const currentCount = this.timestamps.length;

    if (currentCount >= this.maxCalls) {
      const oldestInWindow = this.timestamps[0];
      const resetIn = this.getResetIn(now, oldestInWindow);
      return { allowed: false, currentCount, resetIn };
    }

    this.timestamps.push(now);
    const oldestInWindow = this.timestamps[0];
    const resetIn = this.getResetIn(now, oldestInWindow);
    return { allowed: true, currentCount: currentCount + 1, resetIn };
  }

  private getResetIn(now: number, oldestInWindow: number): number {
    return Math.max(0, oldestInWindow + this.windowMs - now);
  }

  reset(): void {
    this.timestamps = [];
  }

  getStats(): { count: number; windowMs: number; maxCalls: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const count = this.timestamps.filter((ts) => ts > windowStart).length;
    return { count, windowMs: this.windowMs, maxCalls: this.maxCalls };
  }
}

interface GuardLogEntry {
  timestamp: number;
  toolName: string;
  action: 'allowed' | 'blocked' | 'warning' | 'rate_limited' | 'resource_exhausted';
  reason?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  callCount: number;
  resourceUsage?: {
    fileReads: number;
    totalBytes: number;
    commandExecutions: number;
  };
  args?: Record<string, unknown>;
}

interface ResourceUsage {
  fileReads: number;
  totalBytes: number;
  commandExecutions: number;
  peakConcurrentCalls: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const stringify = (v: unknown): unknown => {
    if (v && typeof v === 'object') {
      if (seen.has(v as object)) return '[Circular]';
      seen.add(v as object);
      if (Array.isArray(v)) return v.map(stringify);
      const keys = Object.keys(v).sort();
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = stringify((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(stringify(value));
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type ToolBlocked = {
  blocked: true;
  reason: string;
  callsMade: number;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
};

type ToolAllowed = {
  blocked: false;
  result: ToolResult;
  callsMade: number;
};

type GuardedToolOutcome = ToolBlocked | ToolAllowed;

type ToolExecution = {
  toolCall: ToolCall;
  parsedArgs: unknown;
  execute: () => Promise<ToolResult>;
};

export class ToolGuard {
  private calls = 0;
  private policy: GuardPolicy;
  // 只统计「连续」相同 (tool, args) 的调用次数。中间穿插的任何不同调用都会打断计数，
  // 这样合法的「read -> edit -> 再次 read 同一文件」不会被误判为重复卡死。
  // 只有当 agent 真正原地打转（连续重复同一个调用）时才会触发拦截。
  private lastRepetitionFp: string | null = null;
  private consecutiveRepetitions = 0;
  private noProgressCount = 0;
  private lastResultSig: string | null = null;

  private globalRateLimiter: SlidingWindowRateLimiter;
  private toolRateLimiters = new Map<string, SlidingWindowRateLimiter>();

  private logs: GuardLogEntry[] = [];
  private readonly maxLogs = 2000;

  private resourceUsage: ResourceUsage = {
    fileReads: 0,
    totalBytes: 0,
    commandExecutions: 0,
    peakConcurrentCalls: 0,
  };
  private currentConcurrentCalls = 0;

  constructor(policy: Partial<GuardPolicy> = {}) {
    this.policy = { ...DEFAULT_GUARD_POLICY, ...policy };

    this.globalRateLimiter = new SlidingWindowRateLimiter(
      this.policy.rateLimits.global.windowMs,
      this.policy.rateLimits.global.maxCalls
    );

    for (const [toolName, limitConfig] of Object.entries(this.policy.rateLimits.tools)) {
      this.toolRateLimiters.set(
        toolName,
        new SlidingWindowRateLimiter(limitConfig.windowMs, limitConfig.maxCalls)
      );
    }
  }

  get callsMade() {
    return this.calls;
  }

  get currentResourceUsage(): Readonly<ResourceUsage> {
    return { ...this.resourceUsage };
  }

  getGlobalRateLimitStats() {
    return this.globalRateLimiter.getStats();
  }

  getToolRateLimitStats(toolName: string) {
    return this.toolRateLimiters.get(toolName)?.getStats() ?? null;
  }

  getLogs(): readonly GuardLogEntry[] {
    this.pruneLogs();
    return this.logs;
  }

  getResourceUsageStats(): {
    usage: ResourceUsage;
    limits: ResourceLimits;
    utilization: Record<string, number>;
  } {
    const limits = this.policy.resourceLimits;
    return {
      usage: { ...this.resourceUsage },
      limits,
      utilization: {
        fileReads: this.resourceUsage.fileReads / limits.maxFileReads,
        totalBytes: this.resourceUsage.totalBytes / limits.maxTotalBytes,
        commandExecutions: this.resourceUsage.commandExecutions / limits.maxCommandExecutions,
      },
    };
  }

  isResourceExhausted(): { exhausted: boolean; reason?: string } {
    const limits = this.policy.resourceLimits;
    const usage = this.resourceUsage;

    if (usage.fileReads >= limits.maxFileReads) {
      return { exhausted: true, reason: `文件读取次数已达上限 (${limits.maxFileReads})` };
    }
    if (usage.totalBytes >= limits.maxTotalBytes) {
      return {
        exhausted: true,
        reason: `读取字节数已达上限 (${formatBytes(limits.maxTotalBytes)})`,
      };
    }
    if (usage.commandExecutions >= limits.maxCommandExecutions) {
      return { exhausted: true, reason: `命令执行次数已达上限 (${limits.maxCommandExecutions})` };
    }
    if (this.currentConcurrentCalls >= limits.maxConcurrentCalls) {
      return { exhausted: true, reason: `并发调用数已达上限 (${limits.maxConcurrentCalls})` };
    }

    return { exhausted: false };
  }

  reset() {
    this.calls = 0;
    this.lastRepetitionFp = null;
    this.consecutiveRepetitions = 0;
    this.noProgressCount = 0;
    this.lastResultSig = null;
    this.globalRateLimiter.reset();
    this.toolRateLimiters.forEach((limiter) => limiter.reset());
    this.logs = [];
    this.resourceUsage = {
      fileReads: 0,
      totalBytes: 0,
      commandExecutions: 0,
      peakConcurrentCalls: 0,
    };
  }

  private pruneLogs() {
    const now = Date.now();
    const cutoff = now - this.policy.logRetentionMs;
    this.logs = this.logs.filter((log) => log.timestamp > cutoff);
  }

  private log(entry: GuardLogEntry) {
    if (!this.policy.enableLogging) return;
    this.logs.push({
      ...entry,
      resourceUsage: { ...this.resourceUsage },
    });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  private checkDangerousPatterns(
    toolName: string,
    args: Record<string, unknown>
  ): { isDangerous: boolean; rule?: DangerousToolRule; match?: string } {
    const rules = matchDangerousRules(toolName, args, this.policy);
    if (rules.length === 0) {
      return { isDangerous: false };
    }

    const patternRule = rules.find((rule) => rule.patterns && rule.patterns.length > 0);
    if (patternRule) {
      const commandStr = typeof args.command === 'string' ? args.command : '';
      return { isDangerous: true, rule: patternRule, match: commandStr };
    }

    return { isDangerous: true, rule: rules[0] };
  }

  private checkBlockedPaths(path: string): { blocked: boolean; reason?: string } {
    if (this.policy.blockedPaths) {
      for (const blocked of this.policy.blockedPaths) {
        if (path.includes(blocked)) {
          return { blocked: true, reason: `路径被阻止: ${blocked}` };
        }
      }
    }

    if (this.policy.allowedPaths && this.policy.allowedPaths.length > 0) {
      const isAllowed = this.policy.allowedPaths.some((allowed) => path.includes(allowed));
      if (!isAllowed) {
        return { blocked: true, reason: '路径不在允许列表中' };
      }
    }

    return { blocked: false };
  }

  private updateResourceUsage(toolName: string, result: ToolResult) {
    const resolvedName = resolveToUnderlyingTool(toolName);
    if (
      resolvedName === 'read_file' ||
      resolvedName === 'read' ||
      resolvedName === 'get_file_tree' ||
      resolvedName === 'search_content'
    ) {
      this.resourceUsage.fileReads++;
      const bytes = result.output?.length || 0;
      this.resourceUsage.totalBytes += bytes;
    }

    if (resolvedName === 'run_command') {
      this.resourceUsage.commandExecutions++;
    }
  }

  async runToolGuarded(input: ToolExecution): Promise<GuardedToolOutcome> {
    if (!this.policy.enabled) {
      this.calls += 1;
      const result = await input.execute();
      return { blocked: false, result, callsMade: this.calls };
    }

    const toolName = input.toolCall.function.name;
    const timestamp = Date.now();
    const args = input.parsedArgs as Record<string, unknown>;

    // ============================================================
    // 第零阶段：未知工具拦截。
    // AI 偶尔会幻觉出不存在的工具名。这类调用不会匹配任何 handler，
    // execute() 会立即返回错误。为了不让反复的幻觉调用白白耗尽
    // 全局/工具级限流配额，这里跳过限流直接执行，仅用于取回错误信息。
    // ============================================================
    if (!isKnownToolName(toolName)) {
      this.calls += 1;
      let unknownResult: ToolResult;
      try {
        unknownResult = await input.execute();
      } catch (e: unknown) {
        unknownResult = {
          tool_call_id: input.toolCall.id,
          output: '',
          error: String(e),
        };
      }
      this.log({
        timestamp,
        toolName,
        action: 'blocked',
        reason: `UNKNOWN_TOOL: ${toolName}`,
        callCount: this.calls,
        args,
      });
      return { blocked: false, result: unknownResult, callsMade: this.calls };
    }

    // ============================================================
    // 第一阶段：不消耗限流配额的「判定类」拦截。
    // 这些检查要么是纯函数（危险模式 / 路径），要么只动自身状态
    // （资源耗尽 / 重复检测）。命中任何一个就直接返回，
    // 不去占用 globalRateLimiter / toolRateLimiter 的令牌，
    // 否则反复被拦截的尝试会迅速耗尽限流预算，殃及后续正常调用。
    // ============================================================

    const resourceCheck = this.isResourceExhausted();
    if (resourceCheck.exhausted) {
      this.log({
        timestamp,
        toolName,
        action: 'resource_exhausted',
        reason: resourceCheck.reason,
        callCount: this.calls,
      });
      return {
        blocked: true,
        reason: `RESOURCE_EXHAUSTED: ${resourceCheck.reason}`,
        callsMade: this.calls,
      };
    }

    const dangerCheck = this.checkDangerousPatterns(toolName, args);
    if (dangerCheck.isDangerous && dangerCheck.rule?.riskLevel === 'critical') {
      this.log({
        timestamp,
        toolName,
        action: 'warning',
        reason: `危险操作模式需确认: ${dangerCheck.rule.description || dangerCheck.match}`,
        riskLevel: 'critical',
        callCount: this.calls,
        args,
      });
    }

    const pathArg =
      args.path ||
      args.source ||
      args.destination ||
      args.file_path ||
      args.file ||
      args.repo_path ||
      args.repo;
    if (typeof pathArg === 'string') {
      const pathCheck = this.checkBlockedPaths(pathArg);
      if (pathCheck.blocked) {
        this.log({
          timestamp,
          toolName,
          action: 'blocked',
          reason: pathCheck.reason,
          callCount: this.calls,
          args,
        });
        return { blocked: true, reason: pathCheck.reason!, callsMade: this.calls };
      }
    }

    const fp = await sha256(`${toolName}|${stableStringify(input.parsedArgs)}`);
    // 只统计连续重复：上一次调用是同一个指纹才累加，否则归零。
    // 这样 read(A) -> edit(A) -> read(A) 中间因为穿插了 edit(A)，
    // 第二次 read(A) 的 consecutiveRepetitions 会从 0 重新开始，不会被误封。
    if (this.lastRepetitionFp === fp) {
      this.consecutiveRepetitions += 1;
    } else {
      this.lastRepetitionFp = fp;
      this.consecutiveRepetitions = 1;
    }

    if (this.consecutiveRepetitions >= this.policy.maxRepetitions) {
      const reason = `BLOCKED: 连续重复调用相同工具和参数 ${this.consecutiveRepetitions} 次`;
      this.log({
        timestamp,
        toolName,
        action: 'blocked',
        reason,
        callCount: this.calls,
        args,
      });
      return { blocked: true, reason, callsMade: this.calls };
    }

    // 非致命的危险工具（medium/high）只记 warning，不拦截、不影响后续限流。
    if (dangerCheck.isDangerous) {
      this.log({
        timestamp,
        toolName,
        action: 'warning',
        reason: `危险工具调用: ${dangerCheck.rule?.description || toolName}`,
        riskLevel: dangerCheck.rule?.riskLevel,
        callCount: this.calls,
        args,
      });
    }

    // ============================================================
    // 第二阶段：限流。只对「已通过所有拦截检查、即将真正执行」的调用
    // 计数，被拦截的调用不再吃掉全局 / 工具配额。
    // ============================================================

    const globalLimit = this.globalRateLimiter.tryAcquire();
    if (!globalLimit.allowed) {
      const reason = `RATE_LIMITED: 全局调用限制 (${globalLimit.currentCount}/${this.policy.rateLimits.global.maxCalls} 次/${formatDuration(this.policy.rateLimits.global.windowMs)})，${formatDuration(globalLimit.resetIn)}后重置`;
      this.log({
        timestamp,
        toolName,
        action: 'rate_limited',
        reason,
        callCount: this.calls,
      });
      return { blocked: true, reason, callsMade: this.calls };
    }

    const toolLimiter = this.toolRateLimiters.get(toolName);
    if (toolLimiter) {
      const toolLimit = toolLimiter.tryAcquire();
      if (!toolLimit.allowed) {
        const config = this.policy.rateLimits.tools[toolName];
        const reason = `RATE_LIMITED: ${toolName} 调用限制 (${toolLimit.currentCount}/${config.maxCalls} 次/${formatDuration(config.windowMs)})，${formatDuration(toolLimit.resetIn)}后重置`;
        this.log({
          timestamp,
          toolName,
          action: 'rate_limited',
          reason,
          callCount: this.calls,
        });
        return { blocked: true, reason, callsMade: this.calls };
      }
    }

    this.calls += 1;
    this.currentConcurrentCalls++;
    this.resourceUsage.peakConcurrentCalls = Math.max(
      this.resourceUsage.peakConcurrentCalls,
      this.currentConcurrentCalls
    );

    let result: ToolResult;
    try {
      result = await input.execute();
    } catch (e: unknown) {
      result = {
        tool_call_id: input.toolCall.id,
        output: '',
        error: String(e),
      };
    } finally {
      this.currentConcurrentCalls--;
    }

    this.updateResourceUsage(toolName, result);

    const resultText = result.error || result.output || '';
    const raw = stableStringify({
      tool: toolName,
      args: input.parsedArgs,
      status: result.error ? 'error' : 'ok',
      data: resultText.slice(0, 4000),
    });
    const sig = await sha256(raw);

    // 无进展检测：唯一可靠的信号是「连续多次返回完全相同的结果签名」。
    // 注意签名已把 status(error/ok) 与 (截断后的) data 一起纳入，
    // 所以成功的「搜不到内容」(output 含「未找到」) 与真正的工具错误(error 非空)
    // 会得到不同的签名，不会被互相混淆。
    if (this.lastResultSig && sig === this.lastResultSig) {
      this.noProgressCount += 1;
    } else {
      this.noProgressCount = 0;
    }
    this.lastResultSig = sig;

    if (this.noProgressCount >= this.policy.noProgressThreshold) {
      const reason = `BLOCKED: 检测到连续 ${this.noProgressCount} 次无进展（返回结果完全相同）`;
      this.log({
        timestamp,
        toolName,
        action: 'blocked',
        reason,
        callCount: this.calls,
      });
      return { blocked: true, reason, callsMade: this.calls };
    }

    this.log({
      timestamp,
      toolName,
      action: 'allowed',
      callCount: this.calls,
      args,
    });

    return { blocked: false, result, callsMade: this.calls };
  }
}
