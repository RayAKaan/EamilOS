import { useState, useEffect } from 'react';
import { useStdout } from 'ink';

export function useTerminalSize() {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(() => stdout.columns || 80);
  const [rows, setRows] = useState(() => stdout.rows || 24);

  useEffect(() => {
    const onResize = () => {
      setCols(stdout.columns);
      setRows(stdout.rows);
    };
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  return { cols, rows };
}

export function trunc(text: string, max: number): string {
  if (max < 3) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
