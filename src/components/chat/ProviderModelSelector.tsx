import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from '../shared/Icons';
import { PROVIDERS } from './types';
import type { ChatProtocolSelection } from './types';
import styles from './ProviderModelSelector.module.css';
import {
  COMPOSER_SELECTOR_MENU_ATTR,
  useAnchoredPortalMenu,
} from './useAnchoredPortalMenu';

export interface ProviderModelSelectorProps {
  selectedProtocol: ChatProtocolSelection;
  onSelectProtocol: (protocol: ChatProtocolSelection) => void;
  selectedModel: string;
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>;
  availableModels: string[];
  isDropdownOpen: boolean;
  setIsDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isModelDropdownOpen: boolean;
  setIsModelDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  modelDropdownRef: React.RefObject<HTMLDivElement | null>;
  autoRoutingLabel: string;
  t: {
    common: { selectModel: string };
    settingsBuiltin?: { protocolLabel: string };
  };
  variant?: 'default' | 'ghost';
}

function providerDisplayName(
  provider: { id: string; name: string },
  t: ProviderModelSelectorProps['t']
): string {
  if (provider.id === 'builtin' && t.settingsBuiltin?.protocolLabel) {
    return t.settingsBuiltin.protocolLabel;
  }
  return provider.name;
}

export default function ProviderModelSelector({
  selectedProtocol,
  onSelectProtocol,
  selectedModel,
  setSelectedModel,
  availableModels,
  isDropdownOpen,
  setIsDropdownOpen,
  isModelDropdownOpen,
  setIsModelDropdownOpen,
  dropdownRef,
  modelDropdownRef,
  autoRoutingLabel,
  t,
  variant = 'default',
}: ProviderModelSelectorProps) {
  const isAutoRouting = selectedProtocol === 'auto';
  const selectedProvider = PROVIDERS.find((provider) => provider.id === selectedProtocol);
  const providerName = isAutoRouting
    ? autoRoutingLabel
    : selectedProvider
      ? providerDisplayName(selectedProvider, t)
      : undefined;
  const pillClass =
    variant === 'ghost' ? `${styles.pill} ${styles.pillGhost}` : styles.pill;
  const usePortal = variant === 'ghost';

  const providerAnchorRef = useRef<HTMLButtonElement>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const modelAnchorRef = useRef<HTMLButtonElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const providerMenuPos = useAnchoredPortalMenu(
    usePortal && isDropdownOpen,
    providerAnchorRef,
    providerMenuRef,
    'above'
  );
  const modelMenuPos = useAnchoredPortalMenu(
    usePortal && isModelDropdownOpen && availableModels.length > 1,
    modelAnchorRef,
    modelMenuRef,
    'above'
  );

  const providerItems = (
    <>
      <div
        className={`${styles.dropdownItem} ${
          selectedProtocol === 'auto' ? styles.dropdownItemActive : ''
        }`}
        onClick={() => {
          onSelectProtocol('auto');
          setIsDropdownOpen(false);
        }}
      >
        {autoRoutingLabel}
      </div>
      {PROVIDERS.map((provider) => (
        <div
          key={provider.id}
          className={`${styles.dropdownItem} ${
            selectedProtocol === provider.id ? styles.dropdownItemActive : ''
          }`}
          onClick={() => {
            onSelectProtocol(provider.id);
            setIsDropdownOpen(false);
            setSelectedModel('');
          }}
        >
          {providerDisplayName(provider, t)}
        </div>
      ))}
    </>
  );

  const modelItems = availableModels.map((model) => (
    <div
      key={model}
      className={`${styles.dropdownItem} ${
        selectedModel === model ? styles.dropdownItemActive : ''
      }`}
      onClick={() => {
        setSelectedModel(model);
        setIsModelDropdownOpen(false);
      }}
      title={model}
    >
      {model}
    </div>
  ));

  const renderProviderMenu = () => {
    if (!isDropdownOpen) return null;

    const menuClass = usePortal
      ? `${styles.dropdownPortal} ${styles.dropdown}`
      : styles.dropdown;

    const menu = (
      <div
        ref={providerMenuRef}
        className={menuClass}
        {...(usePortal ? { [COMPOSER_SELECTOR_MENU_ATTR]: '' } : {})}
        style={
          usePortal
            ? {
                top: providerMenuPos.top,
                left: providerMenuPos.left,
                visibility: providerMenuPos.ready ? 'visible' : 'hidden',
              }
            : undefined
        }
      >
        {providerItems}
      </div>
    );

    return usePortal ? createPortal(menu, document.body) : menu;
  };

  const renderModelMenu = () => {
    if (!isModelDropdownOpen || availableModels.length <= 1) return null;

    const menuClass = usePortal
      ? `${styles.dropdownPortal} ${styles.dropdown} ${styles.dropdownScrollable} ${styles.modelDropdown}`
      : `${styles.dropdown} ${styles.dropdownScrollable} ${styles.modelDropdown}`;

    const menu = (
      <div
        ref={modelMenuRef}
        className={menuClass}
        {...(usePortal ? { [COMPOSER_SELECTOR_MENU_ATTR]: '' } : {})}
        style={
          usePortal
            ? {
                top: modelMenuPos.top,
                left: modelMenuPos.left,
                visibility: modelMenuPos.ready ? 'visible' : 'hidden',
              }
            : undefined
        }
      >
        {modelItems}
      </div>
    );

    return usePortal ? createPortal(menu, document.body) : menu;
  };

  return (
    <div className={styles.row}>
      <div
        className={`${styles.wrap} ${variant === 'ghost' ? styles.providerWrapGhost : ''}`}
        ref={dropdownRef}
      >
        <div className={styles.anchor}>
          <button
            ref={providerAnchorRef}
            type="button"
            className={`${pillClass} ${isDropdownOpen ? styles.pillOpen : ''}`}
            title={providerName || 'Provider'}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <span className={styles.pillLabel}>{providerName || 'Provider'}</span>
            <span className={`${styles.chevron} ${isDropdownOpen ? styles.chevronOpen : ''}`}>
              <ChevronDownIcon size={10} />
            </span>
          </button>
          {!usePortal && renderProviderMenu()}
        </div>
        {usePortal && renderProviderMenu()}
      </div>

      {!isAutoRouting && (
        <div
          className={`${styles.wrap} ${
            variant === 'ghost' ? styles.modelWrapGhost : ''
          }`}
          ref={modelDropdownRef}
        >
          <div className={styles.anchor}>
            <button
              ref={modelAnchorRef}
              type="button"
              className={`${pillClass} ${isModelDropdownOpen ? styles.pillOpen : ''}`}
              title={selectedModel || t.common.selectModel}
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
            >
              <span className={styles.pillLabel}>{selectedModel || t.common.selectModel}</span>
              <span
                className={`${styles.chevron} ${isModelDropdownOpen ? styles.chevronOpen : ''}`}
              >
                <ChevronDownIcon size={10} />
              </span>
            </button>
            {!usePortal && renderModelMenu()}
          </div>
          {usePortal && renderModelMenu()}
        </div>
      )}
    </div>
  );
}
