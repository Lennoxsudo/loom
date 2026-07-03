import { memo, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import {
  GraphToolResultView,
  parseGraphToolResult,
} from '../shared/graphToolResult';
import { buildGraphToolResultLabels } from '../shared/graphToolResult/graphToolResultLabels';
import type { Message } from './types';

interface GraphToolResultCardProps {
  message: Message;
}

const GraphToolResultCard = memo(function GraphToolResultCard({
  message,
}: GraphToolResultCardProps) {
  const t = useTranslation();
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content ?? '');

  const view = useMemo(
    () => parseGraphToolResult({
      toolName: message.tool_name,
      toolArgs: message.tool_args,
      text: content,
      isError: message.isError,
    }),
    [message.tool_name, message.tool_args, content, message.isError],
  );

  const labels = useMemo(() => buildGraphToolResultLabels(t), [t]);

  if (!view) return null;

  return <GraphToolResultView view={view} labels={labels} />;
});

export default GraphToolResultCard;
