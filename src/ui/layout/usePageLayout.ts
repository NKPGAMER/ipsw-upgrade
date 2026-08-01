import { useContext, useEffect } from "react";
import { LayoutContext, type PageLayout } from "./LayoutContext";

export function usePageLayout(layout: PageLayout): void {
  const { pushLayout } = useContext(LayoutContext);

  useEffect(() => {
    const cleanup = pushLayout(layout);
    return cleanup;
  }, [layout, pushLayout]);
}
