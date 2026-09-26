"use client";

import { useEffect, useRef } from "react";

/**
 * Yatay kaydırmalı matris kabı. İçinde `data-today` işaretli bir sütun başlığı varsa (cari ay),
 * açılışta bugünün sütunu (sabit sütunlar hariç) görünür alanın ortasına kaydırılır; böylece mobilde 1. günden elle kaydırmak gerekmez.
 */
export function MatrixScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const today = el?.querySelector<HTMLElement>("[data-today]");
    if (!el || !today) return;
    // Sol (ad) ve sağ (toplam) sütunlar sabit; bugünün sütununu geriye kalan görünür alanın ortasına getir.
    const headers = el.querySelectorAll<HTMLElement>("thead th");
    const leftWidth = headers[0]?.offsetWidth ?? 0;
    const rightWidth = headers[headers.length - 1]?.offsetWidth ?? 0;
    const visible = el.clientWidth - leftWidth - rightWidth;
    const offset = today.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    el.scrollLeft = Math.max(0, offset - leftWidth - visible / 2 + today.offsetWidth / 2);
  }, []);

  return (
    <div ref={ref} className="overflow-x-auto rounded-xl border bg-card">
      {children}
    </div>
  );
}
