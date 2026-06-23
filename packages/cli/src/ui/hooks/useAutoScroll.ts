import { useEffect, useRef } from 'react';

export function useAutoScroll(dependency: unknown): {
  ref: React.MutableRefObject<unknown>;
  scrollToBottom: () => void;
} {
  const ref = useRef<unknown>(null);
  const userScrolled = useRef(false);

  const scrollToBottom = () => {
    if (!userScrolled.current) {
      // Handled at component level
    }
  };

  useEffect(() => {
    if (!userScrolled.current) {
      scrollToBottom();
    }
  }, [dependency]);

  return { ref, scrollToBottom };
}
