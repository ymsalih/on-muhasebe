/** Birim testi: Genel Kasa tarih aralığı çözümleme. Çalıştırma: npm run test:range */
import { monthBounds, resolveRange } from "../src/lib/cash/range";

let pass = 0;
let fail = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`);
}
const r = (key: string | undefined, today: string, f?: string, t?: string) => {
  const x = resolveRange(key, today, f, t);
  return [x.key, x.from, x.to];
};

// 2026-09-26 Cumartesi
eq("bugün", r("bugun", "2026-09-26"), ["bugun", "2026-09-26", "2026-09-26"]);
eq("bu hafta: Pazartesi–Pazar (Cumartesi günü)", r("hafta", "2026-09-26"), ["hafta", "2026-09-21", "2026-09-27"]);
eq("bu hafta: bugün Pazartesi ise o gün başlar", r("hafta", "2026-09-21"), ["hafta", "2026-09-21", "2026-09-27"]);
eq("bu hafta: bugün Pazar ise hafta bir önceki Pazartesi'de başlar", r("hafta", "2026-09-27"), ["hafta", "2026-09-21", "2026-09-27"]);
eq("bu hafta: ay sınırını aşar", r("hafta", "2026-10-01"), ["hafta", "2026-09-28", "2026-10-04"]);
eq("bu hafta: yıl sınırını aşar", r("hafta", "2026-12-31"), ["hafta", "2026-12-28", "2027-01-03"]);
eq("bu ay (varsayılan, parametre yok)", r(undefined, "2026-09-26"), ["ay", "2026-09-01", "2026-09-30"]);
eq("bu ay: 31 günlü ay", r("ay", "2026-10-15"), ["ay", "2026-10-01", "2026-10-31"]);
eq("bu ay: şubat (artık yıl değil)", r("ay", "2026-02-10"), ["ay", "2026-02-01", "2026-02-28"]);
eq("bu ay: şubat (artık yıl)", r("ay", "2028-02-10"), ["ay", "2028-02-01", "2028-02-29"]);
eq("bilinmeyen anahtar bu aya döner", r("hacker", "2026-09-26"), ["ay", "2026-09-01", "2026-09-30"]);
eq("özel aralık", r("ozel", "2026-09-26", "2026-08-15", "2026-09-05"), ["ozel", "2026-08-15", "2026-09-05"]);
eq("özel aralık tek gün", r("ozel", "2026-09-26", "2026-09-05", "2026-09-05"), ["ozel", "2026-09-05", "2026-09-05"]);
eq("özel aralık: başlangıç bitişten sonraysa bu aya döner", r("ozel", "2026-09-26", "2026-09-10", "2026-09-01"), ["ozel", "2026-09-01", "2026-09-30"]);
eq("özel aralık: eksik tarih bu aya döner", r("ozel", "2026-09-26", "2026-09-10"), ["ozel", "2026-09-01", "2026-09-30"]);
eq("özel aralık: geçersiz tarih bu aya döner", r("ozel", "2026-09-26", "2026-13-40", "abc"), ["ozel", "2026-09-01", "2026-09-30"]);
eq("özel aralık en fazla 366 gün ile sınırlanır", r("ozel", "2026-09-26", "2020-01-01", "2026-09-01"), ["ozel", "2020-01-01", "2020-12-31"]);
eq("monthBounds", Object.values(monthBounds("2026-11-05")), ["2026-11-01", "2026-11-30"]);

console.log(`\n${pass}/${pass + fail} geçti`);
process.exit(fail === 0 ? 0 : 1);
