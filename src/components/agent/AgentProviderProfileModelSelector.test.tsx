import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AgentProviderProfileModelSelector from './AgentProviderProfileModelSelector';

const profiles = [
  { id: 'profile-a', name: '默认配置', models: ['mimo-v2.5-pro', 'mimo-v2.5'] },
  { id: 'profile-b', name: '英伟达', models: ['glm-4.7-flash'] },
];

afterEach(() => {
  cleanup();
});

describe('AgentProviderProfileModelSelector', () => {
  it('renders provider, profile, and model pills', () => {
    render(
      <AgentProviderProfileModelSelector
        selectedProvider="openai"
        onSelectProvider={vi.fn()}
        selectedProfileId="profile-a"
        selectedProfileName="默认配置"
        availableProfiles={profiles}
        onSelectProfile={vi.fn()}
        selectedModel="mimo-v2.5-pro"
        onSelectModel={vi.fn()}
        availableModels={['mimo-v2.5-pro', 'mimo-v2.5']}
        selectProfileLabel="选择配置"
        selectModelLabel="选择模型"
        profileLabel="协议配置"
        autoRoutingLabel="自动路由"
        variant="ghost"
      />
    );

    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getAllByText('默认配置').length).toBeGreaterThan(0);
    expect(screen.getByText('mimo-v2.5-pro')).toBeInTheDocument();
  });

  it('calls onSelectProfile when a profile is chosen', () => {
    const onSelectProfile = vi.fn();

    render(
      <AgentProviderProfileModelSelector
        selectedProvider="openai"
        onSelectProvider={vi.fn()}
        selectedProfileId="profile-a"
        selectedProfileName="默认配置"
        availableProfiles={profiles}
        onSelectProfile={onSelectProfile}
        selectedModel="mimo-v2.5-pro"
        onSelectModel={vi.fn()}
        availableModels={['mimo-v2.5-pro', 'mimo-v2.5']}
        selectProfileLabel="选择配置"
        selectModelLabel="选择模型"
        profileLabel="协议配置"
        autoRoutingLabel="自动路由"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '协议配置' }));
    fireEvent.click(screen.getByText('英伟达'));

    expect(onSelectProfile).toHaveBeenCalledWith('profile-b');
  });

  it('still renders the profile pill when only one profile exists', () => {
    render(
      <AgentProviderProfileModelSelector
        selectedProvider="openai"
        onSelectProvider={vi.fn()}
        selectedProfileId="profile-a"
        selectedProfileName="默认配置"
        availableProfiles={[profiles[0]!]}
        onSelectProfile={vi.fn()}
        selectedModel="mimo-v2.5-pro"
        onSelectModel={vi.fn()}
        availableModels={['mimo-v2.5-pro']}
        selectProfileLabel="选择配置"
        selectModelLabel="选择模型"
        profileLabel="协议配置"
        autoRoutingLabel="自动路由"
      />
    );

    expect(screen.getAllByText('默认配置').length).toBeGreaterThan(0);
  });

  it('hides profile and model pills when auto routing is selected', () => {
    render(
      <AgentProviderProfileModelSelector
        selectedProvider="auto"
        onSelectProvider={vi.fn()}
        selectedProfileId="profile-a"
        selectedProfileName="默认配置"
        availableProfiles={profiles}
        onSelectProfile={vi.fn()}
        selectedModel="mimo-v2.5-pro"
        onSelectModel={vi.fn()}
        availableModels={['mimo-v2.5-pro', 'mimo-v2.5']}
        selectProfileLabel="选择配置"
        selectModelLabel="选择模型"
        profileLabel="协议配置"
        autoRoutingLabel="自动路由"
      />
    );

    expect(screen.getByText('自动路由')).toBeInTheDocument();
    expect(screen.queryByText('默认配置')).not.toBeInTheDocument();
    expect(screen.queryByText('mimo-v2.5-pro')).not.toBeInTheDocument();
  });
});
