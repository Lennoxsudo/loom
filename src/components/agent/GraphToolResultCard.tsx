import { memo, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { ChatMessage } from '../../types/chat';
import { GraphToolResultView, parseGraphToolResult } from '../shared/graphToolResult';
import { buildGraphToolResultLabels } from '../shared/graphToolResult/graphToolResultLabels';

interface GraphToolResultCardProps {
  message: ChatMessage;
}

const GraphToolResultCard = memo(function GraphToolResultCard({
  message,
}: GraphToolResultCardProps) {
  const t = useTranslation();

  const view = useMemo(
    () =>
      parseGraphToolResult({
        toolName: message.tool_name,
        toolArgs: message.tool_args,
        text: message.text || '',
        isError: message.isError,
      }),
    [message.tool_name, message.tool_args, message.text, message.isError]
  );

  const labels = useMemo(() => buildGraphToolResultLabels(t), [t]);

  if (!view) return null;

  return <GraphToolResultView view={view} labels={labels} />;
});

export default GraphToolResultCard;
