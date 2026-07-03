import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { FolderIcon, SettingsIcon, ZapIcon } from '../shared/Icons';
import type { AgentSettingsSection } from './AgentContent';
import styles from './AgentSettingsView.module.css';

type NavItem = {
  id: AgentSettingsSection;
  label: string;
  icon: ReactNode;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export function AgentSettingsNav({
  activeSection,
  onSectionChange,
}: {
  activeSection: AgentSettingsSection;
  onSectionChange: (section: AgentSettingsSection) => void;
}) {
  const t = useTranslation();
  const [query, setQuery] = useState('');

  const navGroups = useMemo<NavGroup[]>(
    () => [
      {
        id: 'workspace',
        label: t.settingsAgent.navGroups.workspace,
        items: [
          {
            id: 'general',
            label: t.settingsAgent.nav.general,
            icon: <FolderIcon size={14} />,
          },
        ],
      },
      {
        id: 'agent',
        label: t.settingsAgent.navGroups.agent,
        items: [
          {
            id: 'behavior',
            label: t.settingsAgent.groups.behavior,
            icon: <ZapIcon size={14} />,
          },
          {
            id: 'subagent',
            label: t.settingsAgent.subagent.title,
            icon: <SettingsIcon size={14} />,
          },
        ],
      },
    ],
    [t]
  );

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return navGroups;

    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.toLowerCase().includes(normalized)),
      }))
      .filter((group) => group.items.length > 0);
  }, [navGroups, query]);

  useEffect(() => {
    const visibleIds = filteredGroups.flatMap((group) => group.items.map((item) => item.id));
    if (visibleIds.length > 0 && !visibleIds.includes(activeSection)) {
      onSectionChange(visibleIds[0]);
    }
  }, [activeSection, filteredGroups, onSectionChange]);

  return (
    <div data-testid="agent-settings-nav">
      <input
        type="search"
        className={styles.search}
        placeholder={t.search.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={t.search.search}
      />

      {filteredGroups.map((group) => (
        <div key={group.id} className={styles.navGroup}>
          <div className={styles.navGroupLabel}>{group.label}</div>
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.navItem} ${activeSection === item.id ? styles.navItemActive : ''}`}
              onClick={() => onSectionChange(item.id)}
              aria-current={activeSection === item.id ? 'page' : undefined}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
