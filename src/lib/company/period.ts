import { MONTH_NAMES } from "@/lib/personnel/payment-schemas";

export type PeriodMode = "ay" | "yil";

export type CompanyPeriod = {
  mode: PeriodMode;
  from: string;
  to: string;
  label: string;
  /** Bir önceki / sonraki dönemin anahtarı (URL'de `tarih` = YYYY-MM veya `yil` = YYYY) */
  prev: { mode: PeriodMode; key: string };
  next: { mode: PeriodMode; key: string };
  current: { mode: PeriodMode; key: string };
};

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_KEY = /^\d{4}$/;

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/**
 * Şirket kasası dönemi: ay veya yıl. Geçersiz/eksik parametrede bugünün ayı (Europe/Istanbul) kullanılır.
 * `today` YYYY-MM-DD biçimindedir.
 */
export function resolvePeriod(mode: string | undefined, key: string | undefined, today: string): CompanyPeriod {
  const todayYear = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7));

  if (mode === "yil") {
    const year = key && YEAR_KEY.test(key) ? Number(key) : todayYear;
    return {
      mode: "yil",
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      label: String(year),
      prev: { mode: "yil", key: String(year - 1) },
      next: { mode: "yil", key: String(year + 1) },
      current: { mode: "yil", key: String(todayYear) },
    };
  }

  const [year, month] = key && MONTH_KEY.test(key) ? key.split("-").map(Number) : [todayYear, todayMonth];
  const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  return {
    mode: "ay",
    from: `${ym(year, month)}-01`,
    to: `${ym(year, month)}-${String(lastDayOf(year, month)).padStart(2, "0")}`,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    prev: { mode: "ay", key: ym(prev.year, prev.month) },
    next: { mode: "ay", key: ym(next.year, next.month) },
    current: { mode: "ay", key: ym(todayYear, todayMonth) },
  };
}

/** Dönem anahtarını URL parametrelerine çevirir. */
export function periodParams(p: { mode: PeriodMode; key: string }): Record<string, string> {
  return p.mode === "yil" ? { gorunum: "yil", yil: p.key } : { tarih: p.key };
}
