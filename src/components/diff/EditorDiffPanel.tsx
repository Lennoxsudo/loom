/** 主编辑区内的并排差异视图。 */
import { MonacoDiffHost } from '../editor/MonacoHost';
import styles from './EditorDiffPanel.module.css';

export interface EditorDiffPanelProps {
  originalContent: string;
  modifiedContent: string;
  language: string;
  leftLabel: string;
  rightLabel: string;
  themeMode: 'system' | 'dark' | 'light';
  fontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  tabSize: 2 | 4 | 8;
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'all';
  currentLineHighlight: boolean;
  bracketPairColorization: boolean;
}

export function EditorDiffPanel(props: EditorDiffPanelProps) {
  const {
    originalContent,
    modifiedContent,
    language,
    leftLabel,
    rightLabel,
    themeMode,
    fontSize,
    wordWrap,
    lineNumbers,
    minimap,
    tabSize,
    renderWhitespace,
    currentLineHighlight,
    bracketPairColorization,
  } = props;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.sideLabel}>{leftLabel}</span>
        <span className={styles.sep} aria-hidden>
          |
        </span>
        <span className={styles.sideLabel}>{rightLabel}</span>
      </div>
      <div className={styles.editorWrap}>
        <MonacoDiffHost
          original={originalContent}
          modified={modifiedContent}
          language={language}
          readOnly
          renderSideBySide
          fontSize={fontSize}
          wordWrap={wordWrap}
          lineNumbers={lineNumbers}
          minimap={minimap}
          tabSize={tabSize}
          themeMode={themeMode}
          renderWhitespace={renderWhitespace}
          currentLineHighlight={currentLineHighlight}
          bracketPairColorization={bracketPairColorization}
        />
      </div>
    </div>
  );
}
