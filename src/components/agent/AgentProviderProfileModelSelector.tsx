import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from '../shared/Icons';
import { PROVIDERS } from '../chat/types';
import type { AIProvider, AgentProtocolSelection } from '../../utils/agentPersistence';
import type { ProviderProfileOption } from '../../utils/aiProviderRuntime';
import styles from './AgentProviderProfileModelSelector.module.css';
import {
  AGENT_SELECTOR_MENU_ATTR,
  isAgentSelectorMenuTarget,
  useAgentSelectorPortalMenu,
} from './useAgentSelectorPortalMenu';

export interface AgentProviderProfileModelSelectorProps {
  selectedProvider: AgentProtocolSelection;
  onSelectProvider: (provider: AgentProtocolSelection) => void;
  selectedProfileId: string;
  selectedProfileName: string;
  availableProfiles: ProviderProfileOption[];
  onSelectProfile: (profileId: string) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  availableModels: string[];
  selectProfileLabel: string;
  selectModelLabel: string;
  profileLabel: string;
  autoRoutingLabel: string;
  variant?: 'default' | 'ghost';
}

type OpenDropdown = 'provider' | 'profile' | 'model' | null;

export default function AgentProviderProfileModelSelector({
  selectedProvider,
  onSelectProvider,
  selectedProfileId,
  selectedProfileName,
  availableProfiles,
  onSelectProfile,
  selectedModel,
  onSelectModel,
  availableModels,
  selectProfileLabel,
  selectModelLabel,
  profileLabel,
  autoRoutingLabel,
}: AgentProviderProfileModelSelectorProps) {
  const [openDropdown, setOpenDropdown] = useState<OpenDropdown>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const isAutoRouting = selectedProvider === 'auto';

  const providerAnchorRef = useRef<HTMLButtonElement>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const profileAnchorRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const modelAnchorRef = useRef<HTMLButtonElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const providerName =
    selectedProvider === 'auto'
      ? autoRoutingLabel
      : PROVIDERS.find((provider) => provider.id === selectedProvider)?.name;
  const profileLabelText = selectedProfileName || selectProfileLabel;

  const providerMenuPos = useAgentSelectorPortalMenu(
    openDropdown === 'provider',
    providerAnchorRef,
    providerMenuRef,
    'above'
  );
  const profileMenuPos = useAgentSelectorPortalMenu(
    openDropdown === 'profile' && availableProfiles.length > 0,
    profileAnchorRef,
    profileMenuRef,
    'above'
  );
  const modelMenuPos = useAgentSelectorPortalMenu(
    openDropdown === 'model' && availableModels.length > 1,
    modelAnchorRef,
    modelMenuRef,
    'above'
  );

  useEffect(() => {
    if (!openDropdown) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (isAgentSelectorMenuTarget(target)) return;
      if (rootRef.current?.contains(target as Node)) return;
      setOpenDropdown(null);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openDropdown]);

  const toggleDropdown = (target: OpenDropdown) => {
    setOpenDropdown((current) => (current === target ? null : target));
  };

  const renderPortalMenu = (
    open: boolean,
    menuRef: React.RefObject<HTMLDivElement | null>,
    position: { top: number; left: number; ready: boolean },
    className: string,
    children: React.ReactNode
  ) => {
    if (!open) return null;

    return createPortal(
      <div
        ref={menuRef}
        className={`${styles.dropdownPortal} ${styles.dropdown} ${className}`}
        {...{ [AGENT_SELECTOR_MENU_ATTR]: '' }}
        style={{
          top: position.top,
          left: position.left,
          visibility: position.ready ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>,
      document.body
    );
  };

  return (
    <div className={styles.row} ref={rootRef}>
      <div className={`${styles.wrap} ${styles.providerWrap}`}>
        <div className={styles.anchor}>
          <button
            ref={providerAnchorRef}
            type="button"
            className={`${styles.pill} ${openDropdown === 'provider' ? styles.pillOpen : ''}`}
            title={providerName || 'Provider'}
            onClick={() => toggleDropdown('provider')}
          >
            <span className={styles.pillLabel}>{providerName || 'Provider'}</span>
            <span
              className={`${styles.chevron} ${openDropdown === 'provider' ? styles.chevronOpen : ''}`}
            >
              <ChevronDownIcon size={10} />
            </span>
          </button>
        </div>
        {renderPortalMenu(
          openDropdown === 'provider',
          providerMenuRef,
          providerMenuPos,
          '',
          <>
            <div
              className={`${styles.dropdownItem} ${
                selectedProvider === 'auto' ? styles.dropdownItemActive : ''
              }`}
              onClick={() => {
                onSelectProvider('auto');
                setOpenDropdown(null);
              }}
            >
              {autoRoutingLabel}
            </div>
            {PROVIDERS.map((provider) => (
              <div
                key={provider.id}
                className={`${styles.dropdownItem} ${
                  selectedProvider === provider.id ? styles.dropdownItemActive : ''
                }`}
                onClick={() => {
                  onSelectProvider(provider.id as AIProvider);
                  setOpenDropdown(null);
                }}
              >
                {provider.name}
              </div>
            ))}
          </>
        )}
      </div>

      {!isAutoRouting && (
      <div className={`${styles.wrap} ${styles.profileWrap}`}>
        <div className={styles.anchor}>
          <button
            ref={profileAnchorRef}
            type="button"
            className={`${styles.pill} ${openDropdown === 'profile' ? styles.pillOpen : ''}`}
            title={profileLabelText}
            aria-label={profileLabel}
            onClick={() => toggleDropdown('profile')}
          >
            <span className={styles.pillLabel}>{profileLabelText}</span>
            <span
              className={`${styles.chevron} ${openDropdown === 'profile' ? styles.chevronOpen : ''}`}
            >
              <ChevronDownIcon size={10} />
            </span>
          </button>
        </div>
        {renderPortalMenu(
          openDropdown === 'profile' && availableProfiles.length > 0,
          profileMenuRef,
          profileMenuPos,
          `${styles.dropdownScrollable} ${styles.profileDropdown}`,
          availableProfiles.map((profile) => (
            <div
              key={profile.id}
              className={`${styles.dropdownItem} ${
                selectedProfileId === profile.id ? styles.dropdownItemActive : ''
              }`}
              title={profile.name || profile.id}
              onClick={() => {
                onSelectProfile(profile.id);
                setOpenDropdown(null);
              }}
            >
              {profile.name || profile.id}
            </div>
          ))
        )}
      </div>
      )}

      {!isAutoRouting && (
      <div className={`${styles.wrap} ${styles.modelWrap}`}>
        <div className={styles.anchor}>
          <button
            ref={modelAnchorRef}
            type="button"
            className={`${styles.pill} ${openDropdown === 'model' ? styles.pillOpen : ''}`}
            title={selectedModel || selectModelLabel}
            onClick={() => {
              if (availableModels.length > 1) {
                toggleDropdown('model');
              }
            }}
          >
            <span className={styles.pillLabel}>{selectedModel || selectModelLabel}</span>
            {availableModels.length > 1 && (
              <span
                className={`${styles.chevron} ${openDropdown === 'model' ? styles.chevronOpen : ''}`}
              >
                <ChevronDownIcon size={10} />
              </span>
            )}
          </button>
        </div>
        {renderPortalMenu(
          openDropdown === 'model' && availableModels.length > 1,
          modelMenuRef,
          modelMenuPos,
          `${styles.dropdownScrollable} ${styles.modelDropdown}`,
          availableModels.map((model) => (
            <div
              key={model}
              className={`${styles.dropdownItem} ${
                selectedModel === model ? styles.dropdownItemActive : ''
              }`}
              title={model}
              onClick={() => {
                onSelectModel(model);
                setOpenDropdown(null);
              }}
            >
              {model}
            </div>
          ))
        )}
      </div>
      )}
    </div>
  );
}
