/**
 * Subagent Resource Lock Serializer
 *
 * Ensures that parallel subagents trying to write to the same files or terminal sessions
 * are executed sequentially (mutually exclusive) to avoid concurrent write conflicts.
 * Read-only operations can execute concurrently.
 */

class SubagentResourceLock {
  private activeLocks = new Map<string, Promise<void>>();

  /**
   * Checks if a tool is a write-action tool that needs locking
   */
  isWriteTool(toolName: string): boolean {
    const writeTools = [
      'write',
      'write_file',
      'edit',
      'edit_file',
      'term',
      'run_command',
      'move_file',
      'copy_file',
      'delete_file',
      'create_folder',
    ];
    return writeTools.includes(toolName);
  }

  /**
   * Resolves resources affected by this tool call
   */
  private getResourceKeys(toolName: string, args: any): string[] {
    const keys: string[] = [];
    if (!args) return ['global_write'];

    // File writing tools: lock on file path
    if (
      [
        'write',
        'write_file',
        'edit',
        'edit_file',
        'create_folder',
        'delete_file',
        'get_file_info',
        'finfo',
      ].includes(toolName)
    ) {
      const p = args.path || args.filePath || args.folder_path;
      if (typeof p === 'string') {
        keys.push(`file:${p.toLowerCase()}`);
      } else if (Array.isArray(p)) {
        p.forEach((x) => {
          if (typeof x === 'string') keys.push(`file:${x.toLowerCase()}`);
        });
      }
    }
    // Terminal execution: lock on terminal id
    else if (['term', 'run_command'].includes(toolName)) {
      const tid = args.terminal_id || args.tid || 'default_terminal';
      keys.push(`term:${tid}`);
    }
    // File operations: lock on source/destination
    else if (['move_file', 'copy_file'].includes(toolName)) {
      const src = args.source || args.path;
      const dest = args.destination;
      if (typeof src === 'string') keys.push(`file:${src.toLowerCase()}`);
      if (typeof dest === 'string') keys.push(`file:${dest.toLowerCase()}`);
      if (Array.isArray(args.paths)) {
        args.paths.forEach((x: any) => {
          if (typeof x === 'string') keys.push(`file:${x.toLowerCase()}`);
        });
      }
    }

    if (keys.length === 0) {
      keys.push('global_write');
    }
    return keys;
  }

  /**
   * Runs the provided function exclusively if it's a write action,
   * otherwise runs it concurrently.
   */
  async runExclusive<T>(toolName: string, args: any, fn: () => Promise<T>): Promise<T> {
    if (!this.isWriteTool(toolName)) {
      return fn();
    }

    const resourceKeys = this.getResourceKeys(toolName, args);
    const releaseFns: (() => void)[] = [];

    // Sort keys to prevent deadlock (standard dining philosophers resolution)
    const sortedKeys = Array.from(new Set(resourceKeys)).sort();

    for (const key of sortedKeys) {
      const currentLock = this.activeLocks.get(key) || Promise.resolve();

      let resolveLock!: () => void;
      const nextLock = new Promise<void>((resolve) => {
        resolveLock = resolve;
      });

      this.activeLocks.set(key, nextLock);

      await currentLock;
      releaseFns.push(() => {
        resolveLock();
        if (this.activeLocks.get(key) === nextLock) {
          this.activeLocks.delete(key);
        }
      });
    }

    try {
      return await fn();
    } finally {
      // Release in reverse order
      for (let i = releaseFns.length - 1; i >= 0; i--) {
        releaseFns[i]();
      }
    }
  }
}

export const subagentResourceLock = new SubagentResourceLock();
