"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "./ThemeProvider";

// Day/night pill switch: a sky-gradient track that cross-fades between a
// pale-blue "day" layer and a starry "night" layer, with a circular thumb
// that slides across and swaps its sun/moon icon. Purely decorative layers
// (stars, track gradients) are aria-hidden -- the button itself carries the
// accessible label and state.
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  // Avoids a hydration mismatch: the real theme is only known once the
  // no-flash script + ThemeProvider have run on the client, so render a
  // neutral placeholder of the same size until then instead of guessing.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <span className="block size-9 shrink-0 rounded-full border border-border bg-bg-surface" />;
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Өдрийн горимд шилжих" : "Шөнийн горимд шилжих"}
      title={isDark ? "Өдрийн горим" : "Шөнийн горим"}
      className="focus-ring relative flex h-9 w-16 shrink-0 items-center overflow-hidden rounded-full border border-border p-1 transition-colors"
    >
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-sky-300 via-sky-400 to-amber-200 transition-opacity duration-500"
        style={{ opacity: isDark ? 0 : 1 }}
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 transition-opacity duration-500"
        style={{ opacity: isDark ? 1 : 0 }}
      />
      {isDark && (
        <span aria-hidden className="absolute inset-0">
          <span className="absolute left-[20%] top-[25%] size-[3px] rounded-full bg-white/80" />
          <span className="absolute left-[32%] top-[60%] size-[2px] rounded-full bg-white/60" />
          <span className="absolute left-[12%] top-[65%] size-[2px] rounded-full bg-white/50" />
        </span>
      )}

      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className="relative z-10 flex size-7 items-center justify-center rounded-full bg-white shadow-md"
        style={{ marginLeft: isDark ? "calc(100% - 1.75rem)" : 0 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isDark ? (
            <motion.span
              key="moon"
              initial={{ opacity: 0, rotate: -40, scale: 0.6 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 40, scale: 0.6 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-center"
            >
              <Moon className="size-4 fill-indigo-900 text-indigo-900" />
            </motion.span>
          ) : (
            <motion.span
              key="sun"
              initial={{ opacity: 0, rotate: 40, scale: 0.6 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: -40, scale: 0.6 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-center"
            >
              <Sun className="size-4 fill-amber-500 text-amber-500" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
    </button>
  );
}
