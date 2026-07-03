import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeProjectPath } from '../utils';

const STORAGE_KEY = 'loom:agent-project-tree:v1';

function readExpandedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item) => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

function writeExpandedKeys(keys: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(keys)));
  } catch {
    // ignore persist failures
  }
}

export interface UseAgentProjectTreeStateOptions {
  projectPaths: string[];
  activeProjectPath: string;
  selectedThreadProjectPath?: string;
  streamingProjectKeys: Set<string>;
}

export function useAgentProjectTreeState({
  activeProjectPath,
  selectedThreadProjectPath,
  streamingProjectKeys,
}: UseAgentProjectTreeStateOptions) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => readExpandedKeys());
  const [hideEmptyProjects, setHideEmptyProjects] = useState(false);

  const normalizedActive = normalizeProjectPath(activeProjectPath);
  const normalizedSelectedThreadProject = selectedThreadProjectPath
    ? normalizeProjectPath(selectedThreadProjectPath)
    : '';

  const ensureExpanded = useCallback((key: string) => {
    if (!key) return;
    setExpandedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      writeExpandedKeys(next);
      return next;
    });
  }, []);

  useEffect(() => {
    ensureExpanded(normalizedActive);
  }, [normalizedActive, ensureExpanded]);

  useEffect(() => {
    ensureExpanded(normalizedSelectedThreadProject);
  }, [normalizedSelectedThreadProject, ensureExpanded]);

  useEffect(() => {
    if (streamingProjectKeys.size === 0) return;
    setExpandedKeys((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const key of streamingProjectKeys) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      if (!changed) return prev;
      writeExpandedKeys(next);
      return next;
    });
  }, [streamingProjectKeys]);

  const isExpanded = useCallback(
    (projectPath: string) => expandedKeys.has(normalizeProjectPath(projectPath)),
    [expandedKeys]
  );

  const toggleExpanded = useCallback((projectPath: string) => {
    const key = normalizeProjectPath(projectPath);
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      writeExpandedKeys(next);
      return next;
    });
  }, []);

  const expandProject = useCallback((projectPath: string) => {
    const key = normalizeProjectPath(projectPath);
    setExpandedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      writeExpandedKeys(next);
      return next;
    });
  }, []);

  const toggleHideEmptyProjects = useCallback(() => {
    setHideEmptyProjects((prev) => !prev);
  }, []);

  const defaultExpandedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (normalizedActive) keys.add(normalizedActive);
    for (const key of streamingProjectKeys) {
      keys.add(key);
    }
    return keys;
  }, [normalizedActive, streamingProjectKeys]);

  return {
    isExpanded,
    toggleExpanded,
    expandProject,
    hideEmptyProjects,
    toggleHideEmptyProjects,
    defaultExpandedKeys,
  };
}
