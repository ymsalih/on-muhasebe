/** Birim testi: fatura KDV hesabı (matrah / KDV / toplam, KDV hariç ve KDV dahil giriş). Çalıştırma: npm run test:kdv */
import { computeKdv, parseAmount, parseRate, rateLabel, round2 } from "../src/lib/billing/kdv";

let pass = 0;
let fail = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`);
}

// KDV hariç girilen tutar
eq("1000 KDV hariç, %20 → KDV 200, toplam 1200", computeKdv("1000", "20", "net"), { net: 1000, kdv: 200, total: 1200, rate: 20 });
eq("1000 KDV hariç, %10 → KDV 100", computeKdv("1000", "10", "net"), { net: 1000, kdv: 100, total: 1100, rate: 10 });
eq("1000 KDV hariç, %1 → KDV 10", computeKdv("1000", "1", "net"), { net: 1000, kdv: 10, total: 1010, rate: 1 });
eq("KDV yok (%0): KDV 0, toplam = tutar", computeKdv("1234,56", "0", "net"), { net: 1234.56, kdv: 0, total: 1234.56, rate: 0 });
eq("oran boş bırakılırsa %0", computeKdv("500", "", "net"), { net: 500, kdv: 0, total: 500, rate: 0 });
eq("virgüllü tutar ve oran: 2.500,50 → 2500,5 @%7,5", computeKdv("2500,5", "7,5", "net"), { net: 2500.5, kdv: 187.54, total: 2688.04, rate: 7.5 });
eq("kuruş yuvarlama: 33,33 @%20 → KDV 6,67", computeKdv("33,33", "20", "net"), { net: 33.33, kdv: 6.67, total: 40, rate: 20 });

// KDV dahil girilen tutar: toplam girilene EŞİT kalmalı
eq("1200 KDV dahil, %20 → matrah 1000, KDV 200", computeKdv("1200", "20", "gross"), { net: 1000, kdv: 200, total: 1200, rate: 20 });
eq("100,01 KDV dahil, %20 → 83,34 + 16,67", computeKdv("100,01", "20", "gross"), { net: 83.34, kdv: 16.67, total: 100.01, rate: 20 });
eq("118 KDV dahil, %18 → 100 + 18", computeKdv("118", "18", "gross"), { net: 100, kdv: 18, total: 118, rate: 18 });
eq("KDV dahil, %0 → KDV 0", computeKdv("750", "0", "gross"), { net: 750, kdv: 0, total: 750, rate: 0 });

// Değişmezler: her tutar/oran için matrah + KDV = toplam ve KDV matrahın oranıyla (en çok 1 kuruş farkla) uyumlu — veritabanı CHECK'iyle aynı kural
let bad = 0;
for (const rate of [0, 1, 8, 10, 18, 20, 7.5, 100]) {
  for (let cents = 1; cents <= 5000; cents += 7) {
    const amount = (cents / 100).toFixed(2).replace(".", ",");
    for (const mode of ["net", "gross"] as const) {
      const k = computeKdv(amount, String(rate), mode);
      if (!k) { bad++; continue; }
      const sumOk = Math.abs(k.net + k.kdv - k.total) < 0.0001;
      const dbRule = Math.abs(k.kdv - round2((k.net * rate) / 100)) <= 0.01 + 1e-9 && k.kdv >= 0;
      const exact = mode === "gross" ? Math.abs(k.total - Number(amount.replace(",", "."))) < 0.0001 : Math.abs(k.net - Number(amount.replace(",", "."))) < 0.0001;
      if (!sumOk || !dbRule || !exact) bad++;
    }
  }
}
eq("değişmez: matrah + KDV = toplam, veritabanı kuralına uygun, girilen tutar korunur (≈ 5.700 deneme)", bad, 0);

// Geçersiz girdiler
eq("boş tutar geçersiz", computeKdv("", "20", "net"), null);
eq("negatif/sıfır tutar geçersiz", [computeKdv("0", "20", "net"), computeKdv("-5", "20", "net")], [null, null]);
eq("harf içeren tutar geçersiz", computeKdv("12a", "20", "net"), null);
eq("3 ondalıklı tutar geçersiz", computeKdv("10,555", "20", "net"), null);
eq("oran 100'den büyük geçersiz", computeKdv("100", "101", "net"), null);
eq("negatif/harfli oran geçersiz", [computeKdv("100", "-1", "net"), computeKdv("100", "abc", "net")], [null, null]);
eq("parseAmount / parseRate", [parseAmount("1,5"), parseRate("20"), parseRate(""), parseRate("100,5")], [1.5, 20, 0, null]);
eq("rateLabel", [rateLabel(20), rateLabel(7.5), rateLabel(0)], ["%20", "%7,5", "%0"]);

console.log(`\n${pass}/${pass + fail} geçti`);
process.exit(fail ? 1 : 0);
