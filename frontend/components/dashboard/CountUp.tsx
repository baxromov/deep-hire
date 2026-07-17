"use client";

import { useEffect, useRef, useState } from "react";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Animates from 0 to `value` once, on mount / whenever `value` changes. Pure CSS-free — rAF driven. */
export function CountUp({ value, duration = 900, formatter }: { value: number; duration?: number; formatter?: (n: number) => string }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf: number;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const current = Math.round(from + (value - from) * easeOutCubic(t));
      setDisplay(current);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{formatter ? formatter(display) : display.toLocaleString("ru-RU")}</>;
}
