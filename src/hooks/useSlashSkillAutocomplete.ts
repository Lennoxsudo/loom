import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SkillEntry } from '../utils/skills';
import {
  filterSkillsForSlashQuery,
  parseLeadingSlashToken,
  replaceSlashToken,
  type SlashTokenAtCursor,
} from '../utils/skillSlashCommand';

export interface UseSlashSkillAutocompleteOptions {
  value: string;
  skills: SkillEntry[];
  disabled?: boolean;
  getCursor: () => number;
  setValue: (next: string) => void;
  focusAndSetCursor: (cursor: number) => void;
}

export function useSlashSkillAutocomplete({
  value,
  skills,
  disabled = false,
  getCursor,
  setValue,
  focusAndSetCursor,
}: UseSlashSkillAutocompleteOptions) {
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const lastQueryKeyRef = useRef('');

  const refreshCursor = useCallback(() => {
    setCursor(getCursor());
  }, [getCursor]);

  const token = useMemo(() => {
    if (disabled) return null;
    return parseLeadingSlashToken(value, cursor);
  }, [disabled, value, cursor]);

  const queryKey = token ? `${token.start}:${token.query}` : '';

  useEffect(() => {
    if (queryKey !== lastQueryKeyRef.current) {
      lastQueryKeyRef.current = queryKey;
      setDismissed(false);
      setHighlightIndex(0);
    }
  }, [queryKey]);

  const filtered = useMemo(() => {
    if (!token) return [] as SkillEntry[];
    return filterSkillsForSlashQuery(skills, token.query);
  }, [token, skills]);

  const isOpen = !!token && !dismissed && filtered.length > 0;

  const safeIndex = filtered.length === 0 ? 0 : Math.min(highlightIndex, filtered.length - 1);

  const selectSkill = useCallback(
    (skill: SkillEntry, activeToken: SlashTokenAtCursor) => {
      const { nextValue, cursor: nextCursor } = replaceSlashToken(value, activeToken, skill.name);
      setValue(nextValue);
      setDismissed(true);
      setCursor(nextCursor);
      requestAnimationFrame(() => focusAndSetCursor(nextCursor));
    },
    [value, setValue, focusAndSetCursor]
  );

  const selectHighlighted = useCallback(() => {
    if (!token || filtered.length === 0) return false;
    selectSkill(filtered[safeIndex], token);
    return true;
  }, [token, filtered, safeIndex, selectSkill]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % filtered.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + filtered.length) % filtered.length);
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
    [isOpen, filtered.length, selectHighlighted]
  );

  return {
    isOpen,
    filtered,
    highlightIndex: safeIndex,
    setHighlightIndex,
    token,
    onKeyDown,
    refreshCursor,
    selectSkill: (skill: SkillEntry) => {
      if (!token) return;
      selectSkill(skill, token);
    },
    close: () => setDismissed(true),
  };
}
