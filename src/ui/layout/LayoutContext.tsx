import { createContext, useState, useRef, useCallback, type ReactNode } from "react";

export type PageLayout = "default" | "fullContent";

interface LayoutContextValue {
  layout: PageLayout;
  setLayout: (layout: PageLayout) => void;
  pushLayout: (layout: PageLayout) => () => void;
  needSetup: boolean;
}

export const LayoutContext = createContext<LayoutContextValue>({
  layout: "default",
  setLayout: () => {},
  pushLayout: () => () => {},
  needSetup: false,
});

interface LayoutProviderProps {
  children: ReactNode;
  needSetup: boolean;
}

export function LayoutProvider({ children, needSetup }: LayoutProviderProps) {
  const [layout, setLayout] = useState<PageLayout>("default");
  const stackRef = useRef<PageLayout[]>(["default"]);

  const pushLayout = useCallback((newLayout: PageLayout) => {
    stackRef.current.push(newLayout);
    setLayout(newLayout);

    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;

      const idx = stackRef.current.lastIndexOf(newLayout);
      if (idx !== -1) {
        stackRef.current.splice(idx, 1);
      }

      const prev = stackRef.current[stackRef.current.length - 1] ?? "default";
      setLayout(prev);
    };
  }, []);

  return (
    <LayoutContext.Provider value={{ layout, setLayout, pushLayout, needSetup }}>
      {children}
    </LayoutContext.Provider>
  );
}
