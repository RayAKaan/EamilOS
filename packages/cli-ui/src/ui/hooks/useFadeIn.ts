import { useState, useEffect } from 'react';

export function useFadeIn(delay = 0, duration = 150) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return { visible };
}
