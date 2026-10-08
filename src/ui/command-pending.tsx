import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
const PendingContext = createContext<{ pending: boolean; start: () => () => void } | null>(null);
export function CommandScope({ children }: { readonly children: ReactNode }) {
  const [count, setCount] = useState(0);
  const start = useCallback(() => { setCount((value) => value + 1); return () => setCount((value) => value - 1); }, []);
  const value = useMemo(() => ({ pending: count > 0, start }), [count, start]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}
export const useCommandScope = () => useContext(PendingContext);
