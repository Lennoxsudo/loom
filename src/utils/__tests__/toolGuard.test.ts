import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolGuard, DEFAULT_GUARD_POLICY, SlidingWindowRateLimiter, requiresConfirmation } from '../toolGuard';
import type { ToolCall, ToolResult } from '../aiTools';

function createToolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return {
    id: `test-${Date.now()}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function createExecution(
  toolCall: ToolCall,
  result: ToolResult
): { toolCall: ToolCall; parsedArgs: unknown; execute: () => Promise<ToolResult> } {
  return {
    toolCall,
    parsedArgs: JSON.parse(toolCall.function.arguments),
    execute: () => Promise.resolve(result),
  };
}

describe('ToolGuard', () => {
  let guard: ToolGuard;

  beforeEach(() => {
    guard = new ToolGuard({ enableLogging: true });
  });

  describe('Rate Limiting', () => {
    it('should allow calls within rate limit', async () => {
      const toolCall = createToolCall('read_file', { path: '/test/file.txt' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: 'content' };
      const execution = createExecution(toolCall, result);

      const outcome = await guard.runToolGuarded(execution);
      expect(outcome.blocked).toBe(false);
    });

    it('should block calls exceeding tool rate limit', async () => {
      const strictGuard = new ToolGuard({
        rateLimits: {
          global: { windowMs: 60000, maxCalls: 100 },
          tools: { read_file: { windowMs: 60000, maxCalls: 2 } },
        },
      });

      // 注意：每次调用用不同 path，避免被 phase-1 的「连续重复」拦截抢先触发，
      // 从而干净地只验证 rate-limit 契约（maxCalls=2 -> 第 3 次 RATE_LIMITED）。
      const makeResult = (id: string): ToolResult => ({ tool_call_id: id, output: 'content' });

      for (let i = 0; i < 2; i++) {
        const toolCall = createToolCall('read_file', { path: `/test/file${i}.txt` });
        const outcome = await strictGuard.runToolGuarded(createExecution(toolCall, makeResult(toolCall.id)));
        expect(outcome.blocked).toBe(false);
      }

      const toolCall = createToolCall('read_file', { path: '/test/file2.txt' });
      const outcome = await strictGuard.runToolGuarded(createExecution(toolCall, makeResult(toolCall.id)));
      expect(outcome.blocked).toBe(true);
      if (outcome.blocked) {
        expect(outcome.reason).toContain('RATE_LIMITED');
      }
    });

    it('should track global rate limit stats', () => {
      const stats = guard.getGlobalRateLimitStats();
      expect(stats).toHaveProperty('count');
      expect(stats).toHaveProperty('windowMs');
      expect(stats).toHaveProperty('maxCalls');
    });
  });

  describe('Unknown Tool Handling', () => {
    it('should not consume rate-limit budget for unknown tools', async () => {
      // Strict global limit: only 2 calls allowed.
      const strictGuard = new ToolGuard({
        rateLimits: {
          global: { windowMs: 60000, maxCalls: 2 },
          tools: {},
        },
      });

      const errorResult: ToolResult = {
        tool_call_id: 'unknown-1',
        output: '',
        error: '未知的工具: hallucinated_tool',
      };

      // Fire 5 unknown-tool calls — all should bypass rate-limiting.
      for (let i = 0; i < 5; i++) {
        const tc = createToolCall('hallucinated_tool', { foo: i });
        const outcome = await strictGuard.runToolGuarded(
          createExecution(tc, { ...errorResult, tool_call_id: tc.id })
        );
        expect(outcome.blocked).toBe(false);
        if (!outcome.blocked) {
          expect(outcome.result.error).toContain('未知的工具');
        }
      }

      // Global rate limiter should show 0 consumed slots (all bypassed).
      const stats = strictGuard.getGlobalRateLimitStats();
      expect(stats.count).toBe(0);

      // A known tool should still be allowed — budget was not consumed.
      const knownTc = createToolCall('read_file', { path: '/test/file.txt' });
      const knownOutcome = await strictGuard.runToolGuarded(
        createExecution(knownTc, { tool_call_id: knownTc.id, output: 'content' })
      );
      expect(knownOutcome.blocked).toBe(false);
    });

    it('should still allow known tools through normally', async () => {
      const tc = createToolCall('read_file', { path: '/test/file.txt' });
      const outcome = await guard.runToolGuarded(
        createExecution(tc, { tool_call_id: tc.id, output: 'content' })
      );
      expect(outcome.blocked).toBe(false);
    });
  });

  describe('SlidingWindowRateLimiter resetIn', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns remaining window time on allowed acquire, not full windowMs', () => {
      const windowMs = 10_000;
      const limiter = new SlidingWindowRateLimiter(windowMs, 5);

      const first = limiter.tryAcquire();
      expect(first.allowed).toBe(true);
      expect(first.resetIn).toBe(windowMs);

      vi.advanceTimersByTime(3_000);

      const second = limiter.tryAcquire();
      expect(second.allowed).toBe(true);
      expect(second.resetIn).toBe(7_000);
      expect(second.resetIn).toBeLessThan(windowMs);
    });
  });

  describe('Resource Monitoring', () => {
    it('should track file reads', async () => {
      const result: ToolResult = { tool_call_id: 'test', output: 'x'.repeat(1000) };

      for (let i = 0; i < 3; i++) {
        const toolCall = createToolCall('read_file', { path: `/test/file${i}.txt` });
        await guard.runToolGuarded(createExecution(toolCall, result));
      }

      const usage = guard.currentResourceUsage;
      expect(usage.fileReads).toBe(3);
      expect(usage.totalBytes).toBe(3000);
    });

    it('should track command executions', async () => {
      const result: ToolResult = { tool_call_id: 'test', output: 'test' };

      for (let i = 0; i < 3; i++) {
        const toolCall = createToolCall('run_command', { command: `echo test${i}` });
        await guard.runToolGuarded(createExecution(toolCall, result));
      }

      const usage = guard.currentResourceUsage;
      expect(usage.commandExecutions).toBe(3);
    });

    it('should detect resource exhaustion', async () => {
      const strictGuard = new ToolGuard({
        resourceLimits: {
          maxFileReads: 2,
          maxTotalBytes: 10000,
          maxCommandExecutions: 100,
          maxConcurrentCalls: 5,
        },
      });

      const result: ToolResult = { tool_call_id: 'test', output: 'content' };

      await strictGuard.runToolGuarded(createExecution(createToolCall('read_file', { path: '/test/file1.txt' }), result));
      await strictGuard.runToolGuarded(createExecution(createToolCall('read_file', { path: '/test/file2.txt' }), result));

      const outcome = await strictGuard.runToolGuarded(createExecution(createToolCall('read_file', { path: '/test/file3.txt' }), result));
      expect(outcome.blocked).toBe(true);
      if (outcome.blocked) {
        expect(outcome.reason).toContain('RESOURCE_EXHAUSTED');
      }
    });

    it('should provide resource utilization stats', async () => {
      const toolCall = createToolCall('read_file', { path: '/test/file.txt' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: 'content' };
      await guard.runToolGuarded(createExecution(toolCall, result));

      const stats = guard.getResourceUsageStats();
      expect(stats.usage).toBeDefined();
      expect(stats.limits).toBeDefined();
      expect(stats.utilization).toBeDefined();
      expect(stats.utilization.fileReads).toBeGreaterThan(0);
    });
  });

  describe('Dangerous Tool Detection', () => {
    it('should warn for high risk tools', async () => {
      const toolCall = createToolCall('delete_file', { path: '/test/file.txt' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: 'deleted' };
      const execution = createExecution(toolCall, result);

      const outcome = await guard.runToolGuarded(execution);
      expect(outcome.blocked).toBe(false);

      const logs = guard.getLogs();
      const warningLog = logs.find((l) => l.action === 'warning');
      expect(warningLog).toBeDefined();
      expect(warningLog?.riskLevel).toBe('high');
    });
  });

  describe('Repetition Detection', () => {
    it('should block repeated identical calls', async () => {
      const toolCall = createToolCall('read_file', { path: '/test/file.txt' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: 'content' };

      for (let i = 0; i < 2; i++) {
        const outcome = await guard.runToolGuarded(createExecution(toolCall, result));
        expect(outcome.blocked).toBe(false);
      }

      const outcome = await guard.runToolGuarded(createExecution(toolCall, result));
      expect(outcome.blocked).toBe(true);
      if (outcome.blocked) {
        expect(outcome.reason).toContain('重复调用');
      }
    });

    it('should allow different calls', async () => {
      const result: ToolResult = { tool_call_id: 'test', output: 'content' };

      for (let i = 0; i < 5; i++) {
        const toolCall = createToolCall('read_file', { path: `/test/file${i}.txt` });
        const outcome = await guard.runToolGuarded(createExecution(toolCall, result));
        expect(outcome.blocked).toBe(false);
      }
    });

    it('should NOT block legitimate re-reads interleaved with other calls', async () => {
      // 回归：read(A) -> edit(A) -> read(A) 之前会被「指纹永久累积」误判。
      // 现在只统计连续重复，中间穿插的不同调用会打断计数。
      const result: ToolResult = { tool_call_id: 'test', output: 'content' };

      const readA = createToolCall('read_file', { path: '/test/file.txt' });
      const editA = createToolCall('edit_file', { path: '/test/file.txt', content: 'new' });

      // 第一次 read(A)
      let outcome = await guard.runToolGuarded(createExecution(readA, result));
      expect(outcome.blocked).toBe(false);
      // 穿插 edit(A) —— 打断重复计数
      outcome = await guard.runToolGuarded(createExecution(editA, result));
      expect(outcome.blocked).toBe(false);
      // 再次 read(A)：合法的「确认编辑结果」，不应被封
      outcome = await guard.runToolGuarded(createExecution(readA, result));
      expect(outcome.blocked).toBe(false);
    });

    it('should still block a true consecutive loop (read(A) x3)', async () => {
      const readA = createToolCall('read_file', { path: '/test/file.txt' });
      const result: ToolResult = { tool_call_id: readA.id, output: 'content' };

      // 连续 3 次完全相同的调用 —— 真正的原地打转，应该被拦
      await guard.runToolGuarded(createExecution(readA, result));
      await guard.runToolGuarded(createExecution(readA, result));
      const outcome = await guard.runToolGuarded(createExecution(readA, result));
      expect(outcome.blocked).toBe(true);
      if (outcome.blocked) {
        expect(outcome.reason).toContain('连续重复');
      }
    });
  });

  describe('No Progress Detection', () => {
    it('should NOT block a single result that merely contains "未找到" / "not found"', async () => {
      // 回归：旧实现对 output 做裸子串匹配，search_content 在搜不到内容时
      // 会返回 output="未找到包含 ... 的文件"，被误判成无进展并封禁。
      // 现在无进展只看「连续多次结果签名完全相同」，单次命中这些词不应被封。
      const toolCall = createToolCall('search_content', { query: 'xyz' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: '未找到包含 "xyz" 的文件' };

      const outcome = await guard.runToolGuarded(createExecution(toolCall, result));
      expect(outcome.blocked).toBe(false);
    });

    it('should NOT block even if result text naturally contains "不存在" across calls', async () => {
      // 文件正文里本来就可能有「不存在」三个字，连续读不同文件也不应被封。
      const result: ToolResult = { tool_call_id: 'test', output: '该配置项不存在' };
      for (let i = 0; i < 3; i++) {
        const toolCall = createToolCall('read_file', { path: `/test/file${i}.txt` });
        const outcome = await guard.runToolGuarded(createExecution(toolCall, result));
        expect(outcome.blocked).toBe(false);
      }
    });

    it('should block only after consecutive identical results', async () => {
      // 用宽松的 maxRepetitions 隔离掉「重复调用」拦截，单独验证无进展逻辑。
      const isolatedGuard = new ToolGuard({ maxRepetitions: 100, noProgressThreshold: 2 });
      const toolCall = createToolCall('read_file', { path: '/test/file.txt' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: 'same stale content' };

      // 第 1 次：lastResultSig 置位，noProgressCount 仍为 0
      let outcome = await isolatedGuard.runToolGuarded(createExecution(toolCall, result));
      expect(outcome.blocked).toBe(false);
      // 第 2 次：结果签名相同 → noProgressCount=1（< threshold=2），放行
      outcome = await isolatedGuard.runToolGuarded(createExecution(toolCall, result));
      expect(outcome.blocked).toBe(false);
      // 第 3 次：结果签名再次相同 → noProgressCount=2（>= threshold），封禁
      outcome = await isolatedGuard.runToolGuarded(createExecution(toolCall, result));
      expect(outcome.blocked).toBe(true);
      if (outcome.blocked) {
        expect(outcome.reason).toContain('连续');
        expect(outcome.reason).toContain('无进展');
      }
    });

    it('should reset no-progress count when results differ', async () => {
      const isolatedGuard = new ToolGuard({ maxRepetitions: 100, noProgressThreshold: 2 });
      const toolCall = createToolCall('read_file', { path: '/test/file.txt' });

      // 两次相同结果 → noProgressCount=1
      await isolatedGuard.runToolGuarded(createExecution(toolCall, { tool_call_id: toolCall.id, output: 'a' }));
      await isolatedGuard.runToolGuarded(createExecution(toolCall, { tool_call_id: toolCall.id, output: 'a' }));
      // 一次不同结果 → 计数归零
      let outcome = await isolatedGuard.runToolGuarded(
        createExecution(toolCall, { tool_call_id: toolCall.id, output: 'b' })
      );
      expect(outcome.blocked).toBe(false);
    });
  });

  describe('Rate-Limit Quota Interaction', () => {
    it('phase-1-blocked calls must NOT exhaust the rate-limit quota', async () => {
      // 回归：被「判定类」拦截（重复 / 危险 / 路径 / 资源耗尽）的调用从未真正
      // execute，所以不应吃掉限流配额，否则反复被拦的尝试会殃及后续正常调用。
      // 用 blockedPaths 作为 phase-1 拦截的代表：纯函数、可在第 1 次调用就拦截，
      // 不与 repetition / rate-limit 的状态相互耦合，最能干净地隔离本契约。
      //
      // maxCalls=3，发起 5 次会被 phase-1 拦截的调用，再发起 1 次合法调用。
      // 被拦调用不吃配额 -> 合法调用不应被 RATE_LIMITED。
      const strictGuard = new ToolGuard({
        rateLimits: {
          global: { windowMs: 60000, maxCalls: 100 },
          tools: { read_file: { windowMs: 60000, maxCalls: 3 } },
        },
        blockedPaths: ['/blocked'],
      });

      const blockedResult: ToolResult = { tool_call_id: 'b', output: '' };
      for (let i = 0; i < 5; i++) {
        const tc = createToolCall('read_file', { path: `/blocked/${i}.txt` });
        const out = await strictGuard.runToolGuarded(createExecution(tc, blockedResult));
        expect(out.blocked).toBe(true);
      }

      // 5 次被拦都没吃 read_file 配额，所以一次合法 read_file 仍能放行。
      const legit = createToolCall('read_file', { path: '/ok.txt' });
      const out = await strictGuard.runToolGuarded(
        createExecution(legit, { tool_call_id: legit.id, output: 'content' })
      );
      expect(out.blocked).toBe(false);
    });
  });

  describe('Logging', () => {
    it('should log allowed calls', async () => {
      const toolCall = createToolCall('read_file', { path: '/test/file.txt' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: 'content' };
      await guard.runToolGuarded(createExecution(toolCall, result));

      const logs = guard.getLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].action).toBe('allowed');
    });

    it('should include resource usage in logs', async () => {
      const toolCall = createToolCall('read_file', { path: '/test/file.txt' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: 'content' };
      await guard.runToolGuarded(createExecution(toolCall, result));

      const logs = guard.getLogs();
      expect(logs[0].resourceUsage).toBeDefined();
    });
  });

  describe('Reset', () => {
    it('should reset all state', async () => {
      const toolCall = createToolCall('read_file', { path: '/test/file.txt' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: 'content' };

      await guard.runToolGuarded(createExecution(toolCall, result));
      expect(guard.callsMade).toBe(1);

      guard.reset();
      expect(guard.callsMade).toBe(0);
      expect(guard.currentResourceUsage.fileReads).toBe(0);
      expect(guard.getLogs().length).toBe(0);
    });
  });

  describe('Disabled Guard', () => {
    it('should allow all calls when disabled', async () => {
      const disabledGuard = new ToolGuard({ enabled: false });

      const toolCall = createToolCall('run_command', { command: 'rm -rf /' });
      const result: ToolResult = { tool_call_id: toolCall.id, output: '' };
      const outcome = await disabledGuard.runToolGuarded(createExecution(toolCall, result));

      expect(outcome.blocked).toBe(false);
    });
  });
});

describe('requiresConfirmation', () => {
  it('confirms dangerous command patterns in auto mode', () => {
    expect(
      requiresConfirmation('run_command', { command: 'rm -rf /tmp' }, 'auto')
    ).toBe(true);
  });

  it('skips dangerous command patterns in full_access mode', () => {
    expect(
      requiresConfirmation('run_command', { command: 'rm -rf /tmp' }, 'full_access')
    ).toBe(false);
  });

  it('skips normal commands in auto mode', () => {
    expect(requiresConfirmation('run_command', { command: 'npm test' }, 'auto')).toBe(false);
  });

  it('skips normal commands in full_access mode', () => {
    expect(requiresConfirmation('run_command', { command: 'npm test' }, 'full_access')).toBe(false);
  });

  it('skips delete_file in full_access mode', () => {
    expect(requiresConfirmation('delete_file', { path: '/tmp/a.txt' }, 'full_access')).toBe(false);
  });
});

describe('DEFAULT_GUARD_POLICY', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_GUARD_POLICY.enabled).toBe(true);
    expect(DEFAULT_GUARD_POLICY.rateLimits.global.maxCalls).toBeGreaterThan(0);
    expect(DEFAULT_GUARD_POLICY.resourceLimits.maxFileReads).toBeGreaterThan(0);
    expect(DEFAULT_GUARD_POLICY.dangerousTools.length).toBeGreaterThan(0);
  });

  it('should have dangerous command patterns', () => {
    const runCommandRules = DEFAULT_GUARD_POLICY.dangerousTools.filter(
      (r) => r.name === 'run_command' && r.patterns
    );
    expect(runCommandRules.length).toBeGreaterThan(0);
    expect(runCommandRules[0].patterns?.length).toBeGreaterThan(0);
  });
});
