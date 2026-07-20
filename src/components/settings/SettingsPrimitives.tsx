import { useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from '../shared/Icons';
import { parseHexColor, rgbToHex, applyCurrentLineHighlightColor } from '../../utils/lineHighlightColor';
import styles from './SettingsPrimitives.module.css';

export interface SettingsSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className={styles.panel}>{children}</div>;
}

export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionHeaderRow}>
          <h3 className={styles.sectionTitle}>{title}</h3>
          {action ? <div className={styles.sectionAction}>{action}</div> : null}
        </div>
        {description ? <p className={styles.sectionDescription}>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsRow({
  label,
  hint,
  control,
}: {
  label: ReactNode;
  hint?: string;
  control?: ReactNode;
}) {
  return (
    <div className={`${styles.row} ${hint ? styles.rowWithHint : ''}`}>
      <div className={styles.rowLabel}>
        {label}
        {hint ? <span className={styles.rowHint}>{hint}</span> : null}
      </div>
      {control != null ? <div className={styles.rowControl}>{control}</div> : null}
    </div>
  );
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

export function SettingsSegmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.segmented} role="group">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            disabled={disabled}
            className={`${styles.segmentedButton} ${active ? styles.segmentedButtonActive : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsToggle({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`${styles.toggle} ${checked ? styles.toggleChecked : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleThumb} />
    </button>
  );
}

export function SettingsRadioList<T extends string>({
  value,
  options,
  onChange,
  horizontal = false,
  disabled = false,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  horizontal?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`${styles.radioList} ${horizontal ? styles.radioListHorizontal : ''}`}
      role="radiogroup"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={styles.radioOption}
            onClick={() => onChange(option.value)}
          >
            <span className={`${styles.radioDot} ${active ? styles.radioDotActive : ''}`} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SettingsCheckboxRow({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.checkboxRow}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={`${styles.checkboxBox} ${checked ? styles.checkboxBoxChecked : ''}`}>
        {checked ? '✓' : ''}
      </span>
      <span>{label}</span>
    </button>
  );
}

export function SettingsBlockBody({ children }: { children: ReactNode }) {
  return <div className={styles.blockBody}>{children}</div>;
}

export function SettingsNumberInput({
  value,
  min,
  max,
  onChange,
  disabled = false,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const [localVal, setLocalVal] = useState(String(value));

  useEffect(() => {
    setLocalVal(String(value));
  }, [value]);

  const handleBlur = () => {
    let num = parseInt(localVal, 10);
    if (isNaN(num)) {
      num = value;
    }
    if (min !== undefined && num < min) num = min;
    if (max !== undefined && num > max) num = max;
    onChange(num);
    setLocalVal(String(num));
  };

  return (
    <input
      type="number"
      value={localVal}
      min={min}
      max={max}
      disabled={disabled}
      className={styles.numberInput}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          handleBlur();
        }
      }}
    />
  );
}

export function SettingsTextInput({
  value,
  onChange,
  disabled = false,
  placeholder,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      type="text"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      className={styles.textInput}
      style={style}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function clampChannel(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function SettingsRgbColorInput({
  value,
  fallbackHex,
  previewTheme,
  onChange,
  disabled = false,
  resetLabel,
}: {
  value: string | null;
  fallbackHex: string;
  previewTheme?: 'dark' | 'light';
  onChange: (color: string | null) => void;
  disabled?: boolean;
  resetLabel: string;
}) {
  const displayHex = value ?? fallbackHex;
  const rgb = parseHexColor(displayHex) ?? { r: 0, g: 122, b: 204 };
  const colorInputRef = useRef<HTMLInputElement>(null);
  const committedHexRef = useRef(displayHex);
  const pickerFrameRef = useRef(0);
  const pendingHexRef = useRef<string | null>(null);

  const [rVal, setRVal] = useState(String(rgb.r));
  const [gVal, setGVal] = useState(String(rgb.g));
  const [bVal, setBVal] = useState(String(rgb.b));

  useEffect(() => {
    return () => {
      if (pickerFrameRef.current !== 0) {
        cancelAnimationFrame(pickerFrameRef.current);
        pickerFrameRef.current = 0;
      }
    };
  }, []);

  useEffect(() => {
    committedHexRef.current = displayHex;
    const next = parseHexColor(displayHex) ?? { r: 0, g: 122, b: 204 };
    setRVal(String(next.r));
    setGVal(String(next.g));
    setBVal(String(next.b));
    if (colorInputRef.current) {
      colorInputRef.current.value = displayHex;
    }
  }, [displayHex]);

  const syncRgbFields = (hex: string) => {
    const parsed = parseHexColor(hex);
    if (!parsed) return null;
    setRVal(String(parsed.r));
    setGVal(String(parsed.g));
    setBVal(String(parsed.b));
    return rgbToHex(parsed);
  };

  const commitRgb = (r: number, g: number, b: number) => {
    const hex = rgbToHex({ r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) });
    if (hex === committedHexRef.current) return;
    committedHexRef.current = hex;
    if (colorInputRef.current) {
      colorInputRef.current.value = hex;
    }
    if (previewTheme) {
      applyCurrentLineHighlightColor(hex, previewTheme);
    }
    onChange(hex);
  };

  // 颜色选择器拖动时 React 的 onInput 与 onChange 都会随原生 input 事件高频触发，
  // 用 rAF 把"同步 RGB 字段 + 预览 CSS 变量 + 提交到 store"合并到每帧一次，
  // 避免每次拖动都同步触发多次 setState 和 store 更新导致卡顿。
  const schedulePickerCommit = (hex: string) => {
    pendingHexRef.current = hex;
    if (pickerFrameRef.current !== 0) return;
    pickerFrameRef.current = requestAnimationFrame(() => {
      pickerFrameRef.current = 0;
      const next = pendingHexRef.current;
      pendingHexRef.current = null;
      if (next == null) return;
      const parsed = parseHexColor(next);
      if (!parsed) return;
      const normalized = rgbToHex(parsed);
      setRVal(String(parsed.r));
      setGVal(String(parsed.g));
      setBVal(String(parsed.b));
      if (colorInputRef.current) {
        colorInputRef.current.value = normalized;
      }
      if (previewTheme) {
        applyCurrentLineHighlightColor(normalized, previewTheme);
      }
      if (normalized !== committedHexRef.current) {
        committedHexRef.current = normalized;
        onChange(normalized);
      }
    });
  };

  const handleColorPickerInput = (hex: string) => {
    schedulePickerCommit(hex);
  };

  const handleColorPickerChange = (hex: string) => {
    schedulePickerCommit(hex);
  };

  const handleReset = () => {
    if (pickerFrameRef.current !== 0) {
      cancelAnimationFrame(pickerFrameRef.current);
      pickerFrameRef.current = 0;
    }
    pendingHexRef.current = null;
    committedHexRef.current = fallbackHex;
    syncRgbFields(fallbackHex);
    if (colorInputRef.current) {
      colorInputRef.current.value = fallbackHex;
    }
    if (previewTheme) {
      applyCurrentLineHighlightColor(null, previewTheme);
    }
    onChange(null);
  };

  const handleChannelBlur = () => {
    commitRgb(parseInt(rVal, 10), parseInt(gVal, 10), parseInt(bVal, 10));
  };

  return (
    <div className={styles.rgbColorInput} aria-label="RGB color">
      <input
        ref={colorInputRef}
        type="color"
        defaultValue={displayHex}
        disabled={disabled}
        className={styles.colorSwatch}
        onInput={(e) => handleColorPickerInput(e.currentTarget.value)}
        onChange={(e) => handleColorPickerChange(e.currentTarget.value)}
      />
      <div className={styles.rgbChannels}>
        <label className={styles.rgbChannel}>
          <span className={styles.rgbChannelLabel}>R</span>
          <input
            type="number"
            min={0}
            max={255}
            value={rVal}
            disabled={disabled}
            className={styles.rgbChannelInput}
            onChange={(e) => setRVal(e.target.value)}
            onBlur={handleChannelBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleChannelBlur()}
          />
        </label>
        <label className={styles.rgbChannel}>
          <span className={styles.rgbChannelLabel}>G</span>
          <input
            type="number"
            min={0}
            max={255}
            value={gVal}
            disabled={disabled}
            className={styles.rgbChannelInput}
            onChange={(e) => setGVal(e.target.value)}
            onBlur={handleChannelBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleChannelBlur()}
          />
        </label>
        <label className={styles.rgbChannel}>
          <span className={styles.rgbChannelLabel}>B</span>
          <input
            type="number"
            min={0}
            max={255}
            value={bVal}
            disabled={disabled}
            className={styles.rgbChannelInput}
            onChange={(e) => setBVal(e.target.value)}
            onBlur={handleChannelBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleChannelBlur()}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={disabled || value === null}
        className={styles.rgbResetButton}
        onClick={handleReset}
      >
        {resetLabel}
      </button>
    </div>
  );
}

export function SettingsInlineControls({ children }: { children: ReactNode }) {
  return <div className={styles.inlineControls}>{children}</div>;
}

export function SettingsSelect({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = '—',
  mono = false,
  title,
}: {
  value: string;
  options: SettingsSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
  title?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((option) => option.value === value);
  const displayLabel = selected?.label ?? placeholder;

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const maxHeight = 240;
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 160 && rect.top > spaceBelow;

    setMenuStyle({
      position: 'fixed',
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      minWidth: Math.round(rect.width),
      maxWidth: Math.min(420, Math.round(window.innerWidth * 0.9)),
      maxHeight,
      zIndex: 4000,
      top: openUp ? undefined : Math.round(rect.bottom + gap),
      bottom: openUp ? Math.round(window.innerHeight - rect.top + gap) : undefined,
    });
  }, []);

  const isMenuScrollEvent = useCallback((target: EventTarget | null) => {
    return (
      target instanceof Node &&
      (target as HTMLElement).closest?.('[data-settings-select-menu="true"]') != null
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    updateMenuPosition();

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.(`[data-settings-select-menu="true"]`)) return;
      setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const onLayoutChange = (event: Event) => {
      if (isMenuScrollEvent(event.target)) return;
      updateMenuPosition();
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onLayoutChange);
    window.addEventListener('scroll', onLayoutChange, true);

    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onLayoutChange);
      window.removeEventListener('scroll', onLayoutChange, true);
    };
  }, [isMenuScrollEvent, isOpen, updateMenuPosition]);

  const handleSelect = (nextValue: string) => {
    if (nextValue !== value) {
      onChange(nextValue);
    }
    setIsOpen(false);
  };

  const menu =
    isOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            className={styles.selectMenu}
            style={menuStyle}
            role="listbox"
            data-settings-select-menu="true"
            onScroll={(event) => event.stopPropagation()}
          >
            {options.length === 0 ? (
              <div className={styles.selectEmpty}>{placeholder}</div>
            ) : (
              options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  className={`${styles.selectItem} ${mono ? styles.selectItemMono : ''} ${
                    option.value === value ? styles.selectItemActive : ''
                  }`}
                  title={option.label}
                  onClick={() => handleSelect(option.value)}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={styles.selectWrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.selectTrigger} ${mono ? styles.selectTriggerMono : ''} ${
          isOpen ? styles.selectTriggerOpen : ''
        }`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={title ?? displayLabel}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
          }
        }}
      >
        <span className={styles.selectTriggerLabel}>{displayLabel}</span>
        <span className={`${styles.selectChevron} ${isOpen ? styles.selectChevronOpen : ''}`}>
          <ChevronDownIcon size={10} />
        </span>
      </button>
      {menu}
    </div>
  );
}

export function SettingsInlineControlsToggle({ children }: { children: ReactNode }) {
  return <span className={styles.inlineControlsToggle}>{children}</span>;
}

