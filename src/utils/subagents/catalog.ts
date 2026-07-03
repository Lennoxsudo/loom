import type { SubagentDefinition } from './types';

export function buildSubagentCatalogPrompt(agents: SubagentDefinition[]): string {
  if (agents.length === 0) return '';

  const lines = agents.map(
    (a) => `- **${a.name}**: ${a.description}`
  );

  return [
    '## Available Subagents',
    'You can delegate tasks to specialized subagents using the Agent tool with `subagent_type`.',
    'Choose the subagent whose description best matches the task.',
    '',
    ...lines,
    '',
    'Use `subagent_type` to select an agent. Default is `general-purpose` if omitted.',
  ].join('\n');
}

export function buildSubagentCatalogBlock(agents: SubagentDefinition[]): string | undefined {
  const text = buildSubagentCatalogPrompt(agents);
  return text.trim() ? text : undefined;
}
