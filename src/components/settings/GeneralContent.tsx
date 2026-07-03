import { useState } from 'react';
import {
  useTabSize,
  useAutoSaveDelay,
  useFontSize,
  useWordWrap,
  useLineNumbers,
  useMinimap,
  useCursorStyle,
  useCursorBlinking,
  useFormatOnSave,
  useStartupBehavior,
  useExcludePatterns,
  useFileSortBy,
  useFoldersFirst,
  useThemeMode,
  useRenderWhitespace,
  useCurrentLineHighlight,
  useCurrentLineHighlightColor,
  useBracketPairColorization,
  useCompactFolders,
  useAutoRevealCurrentFile,
  useSettingsLoading,
  useUpdateTabSize,
  useUpdateAutoSaveDelay,
  useUpdateFontSize,
  useUpdateWordWrap,
  useUpdateLineNumbers,
  useUpdateMinimap,
  useUpdateCursorStyle,
  useUpdateCursorBlinking,
  useUpdateFormatOnSave,
  useUpdateStartupBehavior,
  useUpdateExcludePatterns,
  useUpdateFileSortBy,
  useUpdateFoldersFirst,
  useUpdateThemeMode,
  useUpdateRenderWhitespace,
  useUpdateCurrentLineHighlight,
  useUpdateCurrentLineHighlightColor,
  useUpdateBracketPairColorization,
  useUpdateCompactFolders,
  useUpdateAutoRevealCurrentFile,
} from '../../stores';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import { resolveThemeFromMode } from '../../utils/lineHighlightColor';
import pageStyles from './SettingsPage.module.css';
import localStyles from './GeneralContent.module.css';
import {
  SettingsBlockBody,
  SettingsInlineControls,
  SettingsInlineControlsToggle,
  SettingsPanel,
  SettingsRadioList,
  SettingsRgbColorInput,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsToggle,
} from './SettingsPrimitives';

export function GeneralContent() {
  const t = useTranslation();
  const tabSize = useTabSize();
  const autoSaveDelay = useAutoSaveDelay();
  const fontSize = useFontSize();
  const wordWrap = useWordWrap();
  const lineNumbers = useLineNumbers();
  const minimap = useMinimap();
  const cursorStyle = useCursorStyle();
  const cursorBlinking = useCursorBlinking();
  const formatOnSave = useFormatOnSave();
  const startupBehavior = useStartupBehavior();
  const excludePatterns = useExcludePatterns();
  const fileSortBy = useFileSortBy();
  const foldersFirst = useFoldersFirst();
  const themeMode = useThemeMode();
  const renderWhitespace = useRenderWhitespace();
  const currentLineHighlight = useCurrentLineHighlight();
  const currentLineHighlightColor = useCurrentLineHighlightColor();
  const bracketPairColorization = useBracketPairColorization();
  const compactFolders = useCompactFolders();
  const autoRevealCurrentFile = useAutoRevealCurrentFile();
  const loading = useSettingsLoading();
  const updateTabSize = useUpdateTabSize();
  const updateAutoSaveDelay = useUpdateAutoSaveDelay();
  const updateFontSize = useUpdateFontSize();
  const updateWordWrap = useUpdateWordWrap();
  const updateLineNumbers = useUpdateLineNumbers();
  const updateMinimap = useUpdateMinimap();
  const updateCursorStyle = useUpdateCursorStyle();
  const updateCursorBlinking = useUpdateCursorBlinking();
  const updateFormatOnSave = useUpdateFormatOnSave();
  const updateStartupBehavior = useUpdateStartupBehavior();
  const updateExcludePatterns = useUpdateExcludePatterns();
  const updateFileSortBy = useUpdateFileSortBy();
  const updateFoldersFirst = useUpdateFoldersFirst();
  const updateThemeMode = useUpdateThemeMode();
  const updateRenderWhitespace = useUpdateRenderWhitespace();
  const updateCurrentLineHighlight = useUpdateCurrentLineHighlight();
  const updateCurrentLineHighlightColor = useUpdateCurrentLineHighlightColor();
  const updateBracketPairColorization = useUpdateBracketPairColorization();
  const updateCompactFolders = useUpdateCompactFolders();
  const updateAutoRevealCurrentFile = useUpdateAutoRevealCurrentFile();
  const { showError } = useNotification();
  const [newPattern, setNewPattern] = useState('');
  const resolvedTheme = resolveThemeFromMode(themeMode);
  const lineHighlightFallbackHex = resolvedTheme === 'dark' ? '#007acc' : '#0b69c7';

  const withUpdate = async (action: () => Promise<void>, errorMessage = t.errors.updateFailed) => {
    try {
      await action();
    } catch {
      showError(errorMessage);
    }
  };

  if (loading) {
    return <div className={pageStyles.loading}>{t.common.loading}</div>;
  }

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsGeneral.title}</h2>
      </header>

      <SettingsPanel>
        <SettingsSection title={t.settingsGeneral.groups.editorDisplay}>
          <SettingsRow
            label={t.settingsGeneral.tabSize.title}
            control={
              <SettingsSegmented
                value={tabSize}
                options={([2, 4, 8] as const).map((size) => ({ value: size, label: String(size) }))}
                onChange={(size) => withUpdate(() => updateTabSize(size))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.fontSize.title}
            control={
              <SettingsSegmented
                value={fontSize}
                options={([12, 14, 16, 18, 20] as const).map((size) => ({
                  value: size,
                  label: String(size),
                }))}
                onChange={(size) => withUpdate(() => updateFontSize(size))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.themeMode.title}
            control={
              <SettingsSegmented
                value={themeMode}
                options={[
                  { value: 'system' as const, label: t.settingsGeneral.themeMode.system },
                  { value: 'dark' as const, label: t.settingsGeneral.themeMode.dark },
                  { value: 'light' as const, label: t.settingsGeneral.themeMode.light },
                ]}
                onChange={(mode) => withUpdate(() => updateThemeMode(mode))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.wordWrap.title}
            control={
              <SettingsToggle
                checked={wordWrap}
                ariaLabel={t.settingsGeneral.wordWrap.title}
                onChange={(enabled) => withUpdate(() => updateWordWrap(enabled))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.lineNumbers.title}
            control={
              <SettingsToggle
                checked={lineNumbers}
                ariaLabel={t.settingsGeneral.lineNumbers.title}
                onChange={(enabled) => withUpdate(() => updateLineNumbers(enabled))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.minimap.title}
            control={
              <SettingsToggle
                checked={minimap}
                ariaLabel={t.settingsGeneral.minimap.title}
                onChange={(enabled) => withUpdate(() => updateMinimap(enabled))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.currentLineHighlight.title}
            control={
              <SettingsInlineControls>
                {currentLineHighlight ? (
                  <SettingsRgbColorInput
                    value={currentLineHighlightColor}
                    fallbackHex={lineHighlightFallbackHex}
                    previewTheme={resolvedTheme}
                    resetLabel={t.settingsGeneral.currentLineHighlight.resetDefault}
                    onChange={(hex) => updateCurrentLineHighlightColor(hex)}
                  />
                ) : null}
                <SettingsInlineControlsToggle>
                  <SettingsToggle
                    checked={currentLineHighlight}
                    ariaLabel={t.settingsGeneral.currentLineHighlight.title}
                    onChange={(enabled) => withUpdate(() => updateCurrentLineHighlight(enabled))}
                  />
                </SettingsInlineControlsToggle>
              </SettingsInlineControls>
            }
          />
          <SettingsRow
            label={t.settingsGeneral.bracketPairColorization.title}
            control={
              <SettingsToggle
                checked={bracketPairColorization}
                ariaLabel={t.settingsGeneral.bracketPairColorization.title}
                onChange={(enabled) => withUpdate(() => updateBracketPairColorization(enabled))}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title={t.settingsGeneral.groups.editorBehavior}>
          <SettingsRow
            label={t.settingsGeneral.autoSave.title}
            control={
              <SettingsSegmented
                value={autoSaveDelay}
                options={[
                  { value: 0, label: t.actions.close },
                  { value: 1000, label: t.settingsGeneral.autoSave.seconds1 },
                  { value: 3000, label: t.settingsGeneral.autoSave.seconds3 },
                  { value: 5000, label: t.settingsGeneral.autoSave.seconds5 },
                  { value: 10000, label: t.settingsGeneral.autoSave.seconds10 },
                ]}
                onChange={(delay) => withUpdate(() => updateAutoSaveDelay(delay))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.formatOnSave.title}
            control={
              <SettingsToggle
                checked={formatOnSave}
                ariaLabel={t.settingsGeneral.formatOnSave.title}
                onChange={(enabled) => withUpdate(() => updateFormatOnSave(enabled))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.renderWhitespace.title}
            control={
              <SettingsSegmented
                value={renderWhitespace}
                options={[
                  { value: 'none' as const, label: t.settingsGeneral.renderWhitespace.none },
                  { value: 'boundary' as const, label: t.settingsGeneral.renderWhitespace.boundary },
                  { value: 'selection' as const, label: t.settingsGeneral.renderWhitespace.selection },
                  { value: 'all' as const, label: t.settingsGeneral.renderWhitespace.all },
                ]}
                onChange={(mode) => withUpdate(() => updateRenderWhitespace(mode))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.cursorStyle.title}
            control={
              <SettingsSegmented
                value={cursorStyle}
                options={[
                  { value: 'line' as const, label: t.settingsGeneral.cursorStyle.line },
                  { value: 'block' as const, label: t.settingsGeneral.cursorStyle.block },
                  { value: 'underline' as const, label: t.settingsGeneral.cursorStyle.underline },
                ]}
                onChange={(style) => withUpdate(() => updateCursorStyle(style))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.cursorBlinking.title}
            control={
              <SettingsSegmented
                value={cursorBlinking}
                options={[
                  { value: 'blink' as const, label: t.settingsGeneral.cursorBlinking.blink },
                  { value: 'smooth' as const, label: t.settingsGeneral.cursorBlinking.smooth },
                  { value: 'phase' as const, label: t.settingsGeneral.cursorBlinking.phase },
                  { value: 'solid' as const, label: t.settingsGeneral.cursorBlinking.off },
                ]}
                onChange={(mode) => withUpdate(() => updateCursorBlinking(mode))}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title={t.settingsGeneral.groups.fileTree}>
          <SettingsRow
            label={t.settingsGeneral.fileSort.title}
            control={
              <SettingsSegmented
                value={fileSortBy}
                options={[
                  { value: 'name' as const, label: t.settingsGeneral.fileSort.name },
                  { value: 'type' as const, label: t.settingsGeneral.fileSort.type },
                  { value: 'modified' as const, label: t.settingsGeneral.fileSort.modified },
                ]}
                onChange={(sortBy) => withUpdate(() => updateFileSortBy(sortBy))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.fileSort.foldersFirst}
            control={
              <SettingsToggle
                checked={foldersFirst}
                ariaLabel={t.settingsGeneral.fileSort.foldersFirst}
                onChange={(checked) => withUpdate(() => updateFoldersFirst(checked))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.compactFolders.title}
            control={
              <SettingsToggle
                checked={compactFolders}
                ariaLabel={t.settingsGeneral.compactFolders.title}
                onChange={(enabled) => withUpdate(() => updateCompactFolders(enabled))}
              />
            }
          />
          <SettingsRow
            label={t.settingsGeneral.autoRevealCurrentFile.title}
            control={
              <SettingsToggle
                checked={autoRevealCurrentFile}
                ariaLabel={t.settingsGeneral.autoRevealCurrentFile.title}
                onChange={(enabled) => withUpdate(() => updateAutoRevealCurrentFile(enabled))}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title={t.settingsGeneral.groups.startup}>
          <SettingsRow label={t.settingsGeneral.startup.title} />
          <SettingsRadioList
            horizontal
            value={startupBehavior}
            options={[
              { value: 'lastProject' as const, label: t.settingsGeneral.startup.lastProject },
              { value: 'welcome' as const, label: t.settingsGeneral.startup.welcome },
              { value: 'empty' as const, label: t.settingsGeneral.startup.empty },
            ]}
            onChange={(behavior) => withUpdate(() => updateStartupBehavior(behavior))}
          />
        </SettingsSection>

        <SettingsSection
          title={t.settingsGeneral.groups.hiddenRules}
          description={t.settingsGeneral.excludePatterns.description}
        >
          <SettingsBlockBody>
            <div className={localStyles.patternList}>
              {excludePatterns.length === 0 ? (
                <div className={localStyles.patternEmpty}>{t.settingsGeneral.excludePatterns.empty}</div>
              ) : (
                excludePatterns.map((pattern, index) => (
                  <div key={index} className={localStyles.patternItem}>
                    <span className={localStyles.patternText}>{pattern}</span>
                    <button
                      onClick={() =>
                        withUpdate(
                          () => updateExcludePatterns(excludePatterns.filter((_, i) => i !== index)),
                          t.errors.deleteFailed
                        )
                      }
                      className={localStyles.deleteButton}
                      title={t.settingsGeneral.excludePatterns.deleteRule}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className={localStyles.inputGroup}>
              <input
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder={t.settingsGeneral.excludePatterns.placeholder}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    newPattern.trim() &&
                    !excludePatterns.includes(newPattern.trim())
                  ) {
                    void withUpdate(async () => {
                      await updateExcludePatterns([...excludePatterns, newPattern.trim()]);
                      setNewPattern('');
                    }, t.errors.createFailed);
                  }
                }}
                className={localStyles.input}
              />
              <button
                onClick={() => {
                  if (newPattern.trim() && !excludePatterns.includes(newPattern.trim())) {
                    void withUpdate(async () => {
                      await updateExcludePatterns([...excludePatterns, newPattern.trim()]);
                      setNewPattern('');
                    }, t.errors.createFailed);
                  }
                }}
                disabled={!newPattern.trim()}
                className={localStyles.primaryButton}
              >
                {t.settingsGeneral.excludePatterns.addRule}
              </button>
            </div>
          </SettingsBlockBody>
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}
