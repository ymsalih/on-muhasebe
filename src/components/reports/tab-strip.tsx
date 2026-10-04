"use client";

import { useEffect, useRef } from "react";

/**
 * Yatay kaydırmalı sekme çubuğu: sayfa açıldığında / sekme değişince SEÇİLİ sekmeyi görünür alana ortalar
 * (telefonda 9 sekme sığmaz; sondaki bir sekmeye girince hangisinde olduğunuz görünsün).
 */
export function TabStrip({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector<HTMLElement>("[aria-current='page']");
    if (!nav || !active) return;
    nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  });

  return (
    <nav ref={ref} aria-label={label} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="relative inline-flex rounded-lg bg-muted p-1">{children}</div>
    </nav>
  );
}
