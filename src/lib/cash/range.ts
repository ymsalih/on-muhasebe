import { addDays, daysBetween } from "@/lib/personnel/status";
import { formatDate } from "@/lib/format";

/** Genel Kasa tarih filtresi (CLAUDE.md 7.3-D): Bugün / Bu Hafta / Bu Ay / Özel Aralık. */
export const RANGE_KEYS = ["bugun", "hafta", "ay", "ozel"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export const RANGE_LABELS: Record<RangeKey, string> = { bugun: "Bugün", hafta: "Bu Hafta", ay: "Bu Ay", ozel: "Özel Aralık" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Özel aralıkta izin verilen en uzun süre (gün). */
export const MAX_CUSTOM_DAYS = 366;

export type ResolvedRange = { key: RangeKey; from: string; to: string; label: string };

export const monthBounds = (today: string) => {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${today.slice(0, 8)}01`, to: `${today.slice(0, 8)}${String(last).padStart(2, "0")}` };
};

/** Pazartesi başlangıçlı hafta (Türkiye). */
const weekBounds = (today: string) => {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Pazar
  const from = addDays(today, -((dow + 6) % 7));
  return { from, to: addDays(from, 6) };
};

/**
 * Süzgeç parametrelerinden tarih aralığını çözer. Geçersiz/eksik özel aralık "Bu Ay"a döner;
 * özel aralık en fazla 366 gün ile sınırlanır (çok geniş sorguları önlemek için).
 */
export function resolveRange(keyParam: string | undefined, today: string, fromParam?: string, toParam?: string): ResolvedRange {
  const key = (RANGE_KEYS.find((k) => k === keyParam) ?? "ay") as RangeKey;

  if (key === "bugun") return { key, from: today, to: today, label: `Bugün · ${formatDate(today)}` };
  if (key === "hafta") {
    const { from, to } = weekBounds(today);
    return { key, from, to, label: `${formatDate(from)} – ${formatDate(to)}` };
  }
  if (key === "ozel" && fromParam && toParam && ISO.test(fromParam) && ISO.test(toParam) && fromParam <= toParam) {
    const to = daysBetween(fromParam, toParam) > MAX_CUSTOM_DAYS - 1 ? addDays(fromParam, MAX_CUSTOM_DAYS - 1) : toParam;
    return { key, from: fromParam, to, label: `${formatDate(fromParam)} – ${formatDate(to)}` };
  }
  const { from, to } = monthBounds(today);
  return { key: key === "ozel" ? "ozel" : "ay", from, to, label: `${formatDate(from)} – ${formatDate(to)}` };
}
