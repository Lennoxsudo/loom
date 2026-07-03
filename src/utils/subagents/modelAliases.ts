import { useSettingsStore } from '../../stores/useSettingsStore';

const DEFAULT_ALIASES: Record<string, string> = {
  sonnet: 'inherit',
  opus: 'inherit',
  haiku: 'inherit',
  fable: 'inherit',
};

export function resolveModelAlias(alias: string | undefined, parentModel: string): string {
  if (!alias || alias === 'inherit') {
    return parentModel;
  }

  const aliases = useSettingsStore.getState().subagentModelAliases ?? DEFAULT_ALIASES;
  const mapped = aliases[alias.toLowerCase()] ?? aliases[alias];
  if (mapped === undefined) {
    return alias;
  }
  if (!mapped || mapped === 'inherit') {
    return parentModel;
  }
  return mapped;
}
