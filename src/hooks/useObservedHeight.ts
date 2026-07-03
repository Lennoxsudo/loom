import { useEffect, useState, type RefObject } from 'react';

export function useObservedHeight<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      setHeight(0);
      return;
    }

    const updateHeight = () => {
      setHeight(element.clientHeight);
    };

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    updateHeight();

    return () => observer.disconnect();
  }, [ref]);

  return height;
}
