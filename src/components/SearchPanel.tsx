import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import styles from './SearchPanel.module.css';
import { FileTypeIcon } from './shared/FileTypeIcon';

type SearchMatch = {
  line: number;
  column: number;
  preview: string;
  match_len: number;
};

type SearchFileResult = {
  path: string;
  matches: SearchMatch[];
};

function getBasename(p: string) {
  return p.split(/[\\/]/).pop() || p;
}

function renderHighlightedText(text: string, query: string, caseSensitive: boolean) {
  const q = query.trim();
  if (!q) return text;

  const source = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? q : q.toLowerCase();
  if (!needle) return text;

  const nodes: React.ReactNode[] = [];
  let from = 0;
  while (from <= source.length) {
    const idx = source.indexOf(needle, from);
    if (idx === -1) break;

    if (idx > from) {
      nodes.push(text.slice(from, idx));
    }

    nodes.push(
      <span
        key={`h-${idx}-${from}`}
        style={{
          backgroundColor: 'rgba(255, 214, 0, 0.22)',
          border: '1px solid rgba(255, 214, 0, 0.28)',
          borderRadius: '3px',
          padding: '0 1px',
          color: 'var(--text-primary)',
        }}
      >
        {text.slice(idx, idx + needle.length)}
      </span>
    );

    from = idx + needle.length;
  }

  if (from < text.length) {
    nodes.push(text.slice(from));
  }

  return nodes.length > 0 ? nodes : text;
}

export default function SearchPanel({
  projectPath,
  onOpenMatch,
  onCollapse,
}: {
  projectPath: string;
  onOpenMatch: (filePath: string, line: number, column: number, matchLen: number) => void;
  onCollapse: () => void;
}) {
  const t = useTranslation();
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);

  const [results, setResults] = useState<SearchFileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const hasProject = !!projectPath;
  const trimmed = query.trim();
  const matchCount = results.reduce((acc, r) => acc + (r.matches?.length || 0), 0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!hasProject) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);

    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await invoke<SearchFileResult[]>('search_in_folder', {
            folderPath: projectPath,
            query: trimmed,
            caseSensitive,
            maxResults: 500,
            maxFileSize: 5_000_000,
          });
          if (reqIdRef.current !== reqId) return;
          setResults(Array.isArray(data) ? data : []);
        } catch (e) {
          if (reqIdRef.current !== reqId) return;
          setResults([]);
          setError(String(e));
        } finally {
          setLoading(false);
        }
      })();
    }, 200);

    return () => {
      window.clearTimeout(t);
    };
  }, [hasProject, projectPath, trimmed, caseSensitive]);

  return (
    <div className={styles.container}>
      <div
        style={{
          height: '34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: '12px', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
          {t.search.title}
        </div>
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse"
          style={{
            all: 'unset',
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={hasProject ? t.placeholders.searchInput : t.search.openFolderToSearch}
            disabled={!hasProject}
            style={{
              all: 'unset',
              flex: 1,
              height: '28px',
              padding: '0 8px',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-primary)',
              color: 'var(--text-primary)',
              fontSize: '12px',
            }}
          />
          <button
            type="button"
            onClick={() => setCaseSensitive((v) => !v)}
            title={t.search.matchCase}
            style={{
              all: 'unset',
              height: '28px',
              minWidth: '34px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: '1px solid var(--border-primary)',
              backgroundColor: caseSensitive
                ? 'color-mix(in srgb, var(--text-accent) 18%, var(--bg-app))'
                : 'var(--bg-input)',
              color: caseSensitive ? 'var(--text-accent)' : 'var(--text-primary)',
              cursor: 'pointer',
              userSelect: 'none',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            Aa
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: 'var(--text-secondary)',
            fontSize: '12px',
          }}
        >
          <div>
            {loading ? t.search.searching : trimmed ? `${matchCount} ${t.search.results}` : ''}
          </div>
          {error ? (
            <div
              style={{
                color: 'var(--text-error)',
                maxWidth: '60%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {!hasProject ? (
          <div className={styles.emptyState} style={{ textAlign: 'left' }}>
            {t.search.openFolderToSearch}
          </div>
        ) : !trimmed ? (
          <div className={styles.emptyState} style={{ textAlign: 'left' }}>
            {t.search.enterKeywordToSearch}
          </div>
        ) : loading && results.length === 0 ? (
          <div className={styles.emptyState} style={{ textAlign: 'left' }}>
            {t.search.searching}
          </div>
        ) : results.length === 0 ? (
          <div className={styles.emptyState} style={{ textAlign: 'left' }}>
            {t.search.noResults}
          </div>
        ) : (
          <div style={{ padding: '6px 0' }}>
            {results.map((file) => {
              const base = getBasename(file.path);
              return (
                <div key={file.path} style={{ padding: '6px 10px' }}>
                  <div
                    style={{
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      marginBottom: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <FileTypeIcon name={base} size={14} />
                    <span>
                      {base}{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>
                        ({file.matches.length})
                      </span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {file.matches.map((m, idx) => (
                      <div
                        key={`${file.path}:${m.line}:${m.column}:${idx}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenMatch(file.path, m.line, m.column, m.match_len)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter')
                            onOpenMatch(file.path, m.line, m.column, m.match_len);
                        }}
                        style={{
                          padding: '6px 8px',
                          borderRadius: '6px',
                          border: '1px solid transparent',
                          backgroundColor: 'transparent',
                          cursor: 'pointer',
                          color: 'var(--text-primary)',
                          fontSize: '14px',
                          lineHeight: '18px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          userSelect: 'none',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                          e.currentTarget.style.borderColor = 'var(--border-primary)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.borderColor = 'transparent';
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)', marginRight: '8px' }}>
                          {m.line}:{m.column}
                        </span>
                        {renderHighlightedText(m.preview, trimmed, caseSensitive)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
