import { useState } from 'react';
import { useTranslation } from '../i18n';
import { type SettingsTab, lastActiveTab } from './settings/types';
import { GeneralContent } from './settings/GeneralContent';
import { AgentContent } from './settings/AgentContent';
import { SkillsContent } from './settings/SkillsContent';
import { PluginsContent } from './settings/PluginsContent';
import { RulesContent } from './settings/RulesContent';
import { AIManagementContent } from './settings/AIManagementContent';
import { AIConfigContent } from './settings/AIConfigContent';
import { MCPConfigContent } from './settings/MCPConfigContent';
import { PreferencesContent } from './settings/PreferencesContent';
import { CodeGraphContent } from './settings/CodeGraphContent';
import { ClaudeContent } from './settings/ClaudeContent';
import { AutoRoutingContent } from './settings/AutoRoutingContent';
import { PortsContent } from './settings/PortsContent';
import { UpdateContent } from './settings/UpdateContent';
import { UsageContent } from './settings/UsageContent';
import styles from './SettingsView.module.css';

function TabItem({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={isActive ? styles.tabItemActive : styles.tabItem}
    >
      {label}
    </button>
  );
}

export default function SettingsView() {
  const t = useTranslation();
  const [activeTab, setActiveTabState] = useState<SettingsTab>(lastActiveTab.current);

  const setActiveTab = (tab: SettingsTab) => {
    lastActiveTab.current = tab;
    setActiveTabState(tab);
  };

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <TabItem
          label={t.settingsTabs.general}
          isActive={activeTab === 'general'}
          onClick={() => setActiveTab('general')}
        />
        <TabItem
          label={t.settingsTabs.agent}
          isActive={activeTab === 'agent'}
          onClick={() => setActiveTab('agent')}
        />
        <TabItem
          label={t.settingsTabs.skills}
          isActive={activeTab === 'skills'}
          onClick={() => setActiveTab('skills')}
        />
        <TabItem
          label={t.settingsTabs.plugins}
          isActive={activeTab === 'plugins'}
          onClick={() => setActiveTab('plugins')}
        />
        <TabItem
          label={t.settingsTabs.rules}
          isActive={activeTab === 'rules'}
          onClick={() => setActiveTab('rules')}
        />
        <TabItem
          label={t.settingsTabs.aiManagement}
          isActive={activeTab === 'ai-management'}
          onClick={() => setActiveTab('ai-management')}
        />
        <TabItem
          label={t.settingsTabs.aiConfig}
          isActive={activeTab === 'ai-config'}
          onClick={() => setActiveTab('ai-config')}
        />
        <TabItem
          label={t.settingsTabs.mcpConfig}
          isActive={activeTab === 'mcp-config'}
          onClick={() => setActiveTab('mcp-config')}
        />
        <TabItem
          label={t.settingsTabs.preferences}
          isActive={activeTab === 'preferences'}
          onClick={() => setActiveTab('preferences')}
        />
        <TabItem
          label={t.settingsTabs.codeGraph}
          isActive={activeTab === 'code-graph'}
          onClick={() => setActiveTab('code-graph')}
        />
        <TabItem
          label={t.settingsTabs.claude}
          isActive={activeTab === 'claude'}
          onClick={() => setActiveTab('claude')}
        />
        <TabItem
          label={t.settingsTabs.autoRouting}
          isActive={activeTab === 'auto-routing'}
          onClick={() => setActiveTab('auto-routing')}
        />
        <TabItem
          label={t.settingsTabs.ports}
          isActive={activeTab === 'ports'}
          onClick={() => setActiveTab('ports')}
        />
        <TabItem
          label={t.settingsTabs.update}
          isActive={activeTab === 'update'}
          onClick={() => setActiveTab('update')}
        />
        <TabItem
          label={t.settingsTabs.usage}
          isActive={activeTab === 'usage'}
          onClick={() => setActiveTab('usage')}
        />
      </div>

      <div className={styles.content}>
        {activeTab === 'general' && <GeneralContent />}
        {activeTab === 'agent' && <AgentContent />}
        {activeTab === 'skills' && <SkillsContent />}
        {activeTab === 'plugins' && <PluginsContent />}
        {activeTab === 'rules' && <RulesContent />}
        {activeTab === 'ai-management' && <AIManagementContent />}
        {activeTab === 'ai-config' && <AIConfigContent />}
        {activeTab === 'mcp-config' && <MCPConfigContent />}
        {activeTab === 'preferences' && <PreferencesContent />}
        {activeTab === 'code-graph' && <CodeGraphContent />}
        {activeTab === 'claude' && <ClaudeContent />}
        {activeTab === 'auto-routing' && <AutoRoutingContent />}
        {activeTab === 'ports' && <PortsContent />}
        {activeTab === 'update' && <UpdateContent />}
        {activeTab === 'usage' && <UsageContent />}
      </div>
    </div>
  );
}
