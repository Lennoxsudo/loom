import { memo } from 'react';
import type { UserMsgMarker } from './userMsgMarkerPositions';

export interface ChatScrollMarkersProps {
  markers: UserMsgMarker[];
  onJumpToMessage: (messageId: string) => void;
}

function ChatScrollMarkers({ markers, onJumpToMessage }: ChatScrollMarkersProps) {
  if (markers.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '8px',
        bottom: '8px',
        right: 0,
        width: '8px',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {markers.map((m) => (
        <div
          key={m.id}
          style={{
            position: 'absolute',
            left: '-4px',
            right: '-4px',
            top: `calc(${m.top}% - 6px)`,
            height: '15px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'auto',
            cursor: 'pointer',
          }}
          onClick={() => onJumpToMessage(m.id)}
          onMouseEnter={(e) => {
            const dot = e.currentTarget.querySelector<HTMLElement>('[data-marker-dot]');
            if (dot) {
              dot.style.background = 'rgba(56, 189, 248, 0.85)';
              dot.style.transform = 'scaleX(1.5)';
            }
          }}
          onMouseLeave={(e) => {
            const dot = e.currentTarget.querySelector<HTMLElement>('[data-marker-dot]');
            if (dot) {
              dot.style.background = 'rgba(56, 189, 248, 0.4)';
              dot.style.transform = 'scaleX(1)';
            }
          }}
          title="Jump to your message"
        >
          <div
            data-marker-dot
            style={{
              width: '6px',
              height: '3px',
              background: 'rgba(56, 189, 248, 0.4)',
              borderRadius: '1.5px',
              transition: 'background 0.15s ease, transform 0.15s ease',
            }}
          />
        </div>
      ))}
    </div>
  );
}

export default memo(ChatScrollMarkers);
