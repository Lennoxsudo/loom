import { forwardRef, type ComponentProps } from 'react';

type ChatPinnedScrollerProps = ComponentProps<'div'>;

const ChatPinnedScroller = forwardRef<HTMLDivElement, ChatPinnedScrollerProps>(
  function ChatPinnedScroller({ children, style, ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        style={{ ...style, position: 'relative' }}
        data-virtuoso-scroller
      >
        {children}
      </div>
    );
  }
);

export default ChatPinnedScroller;
