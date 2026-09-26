"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Sunucu verisini canlı tutar: sekme yeniden odaklanınca, görünür hale gelince ve belirli aralıkla sayfayı
 * tazeler (`router.refresh()` istemci durumunu korur). Aynı ekranı iki sekmede/iki kişinin açması halinde
 * ekranların birbirinden kopmasını (ör. matristen yapılan işaretin günlük listede görünmemesini) önler.
 */
export function useLiveRefresh(enabled: boolean, intervalMs = 15_000) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, intervalMs, router]);
}
