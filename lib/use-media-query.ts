import { useSyncExternalStore } from "react";

// SSR-safe media query. The server snapshot is `defaultValue`; React swaps in the
// real value right after hydration without a mismatch warning.
export function useMediaQuery(query: string, defaultValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => defaultValue
  );
}
