import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  createContextAnnotationId,
  parseAtMentionToken,
  parentFolderPaths,
  replaceAtMentionToken,
  type AtMentionToken,
  type ContextAnnotation,
} from '../utils/contextAnnotations';
import type { ContextMentionItem } from '../components/shared/ContextMentionMenu';

const MAX_FILE_RESULTS = 20;
const SEARCH_DEBOUNCE_MS = 150;

export interface UseContextMentionAutocompleteOptions {
  value: string;
  projectPath: string;
  disabled?: boolean;
  /** When true, suppress @ menu (e.g. slash skill menu is open) */
  suppress?: boolean;
  getCursor: () => number;
  setValue: (next: string) => void;
  focusAndSetCursor: (cursor: number) => void;
  onAddAnnotation: (annotation: ContextAnnotation) => void;
  codebaseDescription?: string;
}

function buildGlobPattern(query: string): string {
  const q = query.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!q) return '**/*';
  if (q.includes('*')) return q;
  if (q.endsWith('/')) return `**/${q.slice(0, -1)}/**`;
  return `**/*${q}*`;
}

export function useContextMentionAutocomplete({
  value,
  projectPath,
  disabled = false,
  suppress = false,
  getCursor,
  setValue,
  focusAndSetCursor,
  onAddAnnotation,
  codebaseDescription = 'Entire project',
}: UseContextMentionAutocompleteOptions) {
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [fileHits, setFileHits] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const lastQueryKeyRef = useRef('');
  const searchGenRef = useRef(0);

  const refreshCursor = useCallback(() => {
    setCursor(getCursor());
  }, [getCursor]);

  const token = useMemo(() => {
    if (disabled || suppress) return null;
    return parseAtMentionToken(value, cursor);
  }, [disabled, suppress, value, cursor]);

  const queryKey = token ? `${token.start}:${token.query}` : '';

  useEffect(() => {
    if (queryKey !== lastQueryKeyRef.current) {
      lastQueryKeyRef.current = queryKey;
      setDismissed(false);
      setHighlightIndex(0);
    }
  }, [queryKey]);

  useEffect(() => {
    if (!token || !projectPath.trim()) {
      setFileHits([]);
      setSearching(false);
      return;
    }

    const query = token.query.trim();
    // Empty query: only @codebase — skip full-tree glob
    if (!query) {
      setFileHits([]);
      setSearching(false);
      return;
    }

    const gen = ++searchGenRef.current;
    setSearching(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const pattern = buildGlobPattern(query);
          const results = await invoke<string[]>('glob_search_files', {
            rootPath: projectPath,
            pattern,
            maxResults: MAX_FILE_RESULTS,
            exclude: null,
            maxDepth: null,
            source: null,
          });
          if (searchGenRef.current !== gen) return;
          setFileHits(Array.isArray(results) ? results : []);
        } catch {
          if (searchGenRef.current !== gen) return;
          setFileHits([]);
        } finally {
          if (searchGenRef.current === gen) {
            setSearching(false);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [token, projectPath]);

  const items = useMemo(() => {
    if (!token) return [] as ContextMentionItem[];
    const q = token.query.trim().toLowerCase();
    const list: ContextMentionItem[] = [];

    if (!q || 'codebase'.startsWith(q) || 'codebase'.includes(q)) {
      list.push({
        kind: 'codebase',
        label: 'codebase',
        path: projectPath,
        description: codebaseDescription,
      });
    }

    const folderSet = new Set<string>();
    for (const file of fileHits) {
      const rel = file.replace(/\\/g, '/');
      if (q && !rel.toLowerCase().includes(q) && !q.endsWith('/')) {
        // glob already filtered; keep
      }
      list.push({
        kind: 'file',
        label: rel,
        path: rel,
      });
      for (const folder of parentFolderPaths(rel)) {
        if (folderSet.has(folder)) continue;
        if (q && !folder.toLowerCase().includes(q.replace(/\/$/, ''))) continue;
        folderSet.add(folder);
        list.push({
          kind: 'folder',
          label: folder,
          path: folder,
        });
      }
    }

    // Prefer codebase, then folders matching query ending with /, then files
    const codebase = list.filter((i) => i.kind === 'codebase');
    const folders = list.filter((i) => i.kind === 'folder').slice(0, 8);
    const files = list.filter((i) => i.kind === 'file').slice(0, MAX_FILE_RESULTS);
    return [...codebase, ...folders, ...files];
  }, [token, fileHits, projectPath, codebaseDescription]);

  const isOpen = !!token && !dismissed && (items.length > 0 || searching);

  const safeIndex = items.length === 0 ? 0 : Math.min(highlightIndex, items.length - 1);

  const selectItem = useCallback(
    (item: ContextMentionItem, activeToken: AtMentionToken) => {
      const { nextValue, cursor: nextCursor } = replaceAtMentionToken(
        value,
        activeToken,
        item.label
      );
      setValue(nextValue);
      onAddAnnotation({
        id: createContextAnnotationId(),
        kind: item.kind,
        path: item.path,
        label: item.label,
      });
      setDismissed(true);
      setCursor(nextCursor);
      requestAnimationFrame(() => focusAndSetCursor(nextCursor));
    },
    [value, setValue, onAddAnnotation, focusAndSetCursor]
  );

  const selectHighlighted = useCallback(() => {
    if (!token || items.length === 0) return false;
    selectItem(items[safeIndex], token);
    return true;
  }, [token, items, safeIndex, selectItem]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen || items.length === 0) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectHighlighted();
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return true;
      }
      return false;
    },
    [isOpen, items.length, selectHighlighted]
  );

  return {
    isOpen: isOpen && items.length > 0,
    items,
    highlightIndex: safeIndex,
    setHighlightIndex,
    token,
    onKeyDown,
    refreshCursor,
    selectItem: (item: ContextMentionItem) => {
      if (!token) return;
      selectItem(item, token);
    },
    close: () => setDismissed(true),
  };
}
