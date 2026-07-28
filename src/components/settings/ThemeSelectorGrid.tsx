import type { ThemeMode } from '../../types/settings';
import { useTranslation } from '../../i18n';
import styles from './ThemeSelectorGrid.module.css';

export interface CompactThemeOption {
  id: ThemeMode;
  name: string;
  colors: string[];
  isSystem?: boolean;
}

export interface ThemeSelectorGridProps {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

export function ThemeSelectorGrid({ value, onChange }: ThemeSelectorGridProps) {
  const t = useTranslation();

  const themes: CompactThemeOption[] = [
    {
      id: 'oled-void',
      name: t.settingsGeneral.themeMode.oledVoid.split(' ')[0], // 暗夜极光
      colors: ['#040407', '#00F5A0'],
    },
    {
      id: 'titanium-dusk',
      name: t.settingsGeneral.themeMode.titaniumDusk.split(' ')[0], // 黑曜钛金
      colors: ['#0B0C10', '#F59E0B'],
    },
    {
      id: 'nordic-aurora',
      name: t.settingsGeneral.themeMode.nordicAurora.split(' ')[0], // 极光深蓝
      colors: ['#070D18', '#38BDF8'],
    },
    {
      id: 'studio-paper',
      name: t.settingsGeneral.themeMode.studioPaper.split(' ')[0], // 绢白书卷
      colors: ['#FAF8F5', '#D97706'],
    },
    {
      id: 'cyber-crimson',
      name: t.settingsGeneral.themeMode.cyberCrimson.split(' ')[0], // 赛博赤红
      colors: ['#040204', '#FF2A6D'],
    },
    {
      id: 'matcha-sage',
      name: t.settingsGeneral.themeMode.matchaSage.split(' ')[0], // 竹韵抹绿
      colors: ['#0A120E', '#34D399'],
    },
    {
      id: 'system',
      name: t.settingsGeneral.themeMode.system, // 跟随系统
      colors: [],
      isSystem: true,
    },
  ];

  return (
    <div className={styles.container}>
      <h3 className={styles.headerTitle}>{t.settingsGeneral.themeMode.title}</h3>
      <div className={styles.grid2Row}>
        {themes.map((theme) => {
          const active =
            value === theme.id ||
            (theme.id === 'oled-void' && value === 'dark') ||
            (theme.id === 'studio-paper' && value === 'light');
          return (
            <button
              key={theme.id}
              type="button"
              className={`${styles.pill} ${active ? styles.pillActive : ''}`}
              onClick={() => onChange(theme.id)}
              title={theme.name}
            >
              {theme.isSystem ? (
                <span className={styles.systemDot} />
              ) : (
                <div className={styles.dotsRow}>
                  {theme.colors.map((c, idx) => (
                    <span key={idx} className={styles.dot} style={{ backgroundColor: c }} />
                  ))}
                </div>
              )}
              <span className={styles.pillTitle}>{theme.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
