"use client";

import { useEffect, useRef } from "react";
import type { MatchStep } from "@/components/vacancies/MatchTimeline";

/** Persists a matching method's step timeline to localStorage and restores it on
 * mount, so the timeline survives a page refresh instead of vanishing — even though
 * a run's real "done"/"error" outcome is what usually reached localStorage last, so
 * restored steps read as a finished/historical timeline, never as a live one (the
 * caller's own `running` state always starts false on a fresh page load regardless). */
export function usePersistedSteps(key: string, steps: MatchStep[], setSteps: (steps: MatchStep[]) => void) {
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = localStorage.getItem(key);
      if (saved) setSteps(JSON.parse(saved));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (steps.length > 0) localStorage.setItem(key, JSON.stringify(steps));
      else localStorage.removeItem(key);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);
}
