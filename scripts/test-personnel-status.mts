/** Birim testi: personelin tarihlerden türetilen güncel durumu. Çalıştırma: npm run test:status */
import { effectiveStatus, addDays, shortNote, type StatusInput } from "../src/lib/personnel/status";

const base: StatusInput = {
  status: "aktif",
  termination_date: null,
  temp_assignment_start: null,
  report_start: null,
  leave_start: null,
  return_date: null,
  absence_days_count: null,
};
const p = (o: Partial<StatusInput>): StatusInput => ({ ...base, ...o });

let pass = 0;
let fail = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`);
}
const st = (o: Partial<StatusInput>, today: string) => effectiveStatus(p(o), today).status;

// Kullanıcının örneği: izin 25 Ekim, dönüş 29 Ekim
const izin = { leave_start: "2026-10-25", return_date: "2026-10-29" };
eq("izin başlamadan önce: aktif", st(izin, "2026-10-24"), "aktif");
eq("izin başlamadan önce: yaklaşan izin bilgisi var", effectiveStatus(p(izin), "2026-10-24").upcoming?.start, "2026-10-25");
eq("izin başlangıç günü: izinli", st(izin, "2026-10-25"), "izinli");
eq("izin ortası: izinli", st(izin, "2026-10-27"), "izinli");
eq("dönüşten önceki son gün: izinli", st(izin, "2026-10-28"), "izinli");
eq("dönüş günü: aktif (işe döndü)", st(izin, "2026-10-29"), "aktif");
eq("dönüşten sonra: aktif", st(izin, "2026-11-15"), "aktif");
eq("dönüşten sonra: yaklaşan yok", effectiveStatus(p(izin), "2026-11-15").upcoming, null);

eq("rapor: raporlu", st({ report_start: "2026-10-01", return_date: "2026-10-05" }, "2026-10-03"), "raporlu");
eq("geçici görev: gecici_gorevde", st({ temp_assignment_start: "2026-10-01", return_date: "2026-10-10" }, "2026-10-03"), "gecici_gorevde");
eq("dönüş tarihi yok: açık uçlu izin sürer", st({ leave_start: "2026-10-01" }, "2027-03-01"), "izinli");
eq("dönüş yok, gün sayısı var: sayıyla biter (5 gün)", st({ leave_start: "2026-10-01", absence_days_count: 5 }, "2026-10-05"), "izinli");
eq("dönüş yok, gün sayısı var: 6. gün aktif", st({ leave_start: "2026-10-01", absence_days_count: 5 }, "2026-10-06"), "aktif");
eq("dönüş tarihi gün sayısından önceliklidir", st({ leave_start: "2026-10-01", return_date: "2026-10-03", absence_days_count: 30 }, "2026-10-04"), "aktif");
eq("dönüş başlangıçtan önceyse yok sayılır (açık uçlu)", st({ leave_start: "2026-10-10", return_date: "2026-10-05" }, "2026-10-20"), "izinli");

// Birden çok dönem
const iki = { leave_start: "2026-10-01", report_start: "2026-10-10", return_date: "2026-10-20" };
eq("izin sonrası rapor başlayınca izin biter: 5 Ekim izinli", st(iki, "2026-10-05"), "izinli");
eq("rapor başlangıcı: raporlu", st(iki, "2026-10-10"), "raporlu");
eq("rapor dönüşe kadar sürer", st(iki, "2026-10-19"), "raporlu");
eq("dönüşte aktif", st(iki, "2026-10-20"), "aktif");

// Ayrılma
eq("kayıtlı durum ayrildi: ayrıldı", st({ status: "ayrildi" }, "2026-10-01"), "ayrildi");
eq("ayrıldı, izin tarihi olsa da: ayrıldı", st({ status: "ayrildi", leave_start: "2026-10-01" }, "2026-10-02"), "ayrildi");
eq("çıkış tarihi geçmişte: ayrıldı", st({ termination_date: "2026-09-30" }, "2026-10-01"), "ayrildi");
eq("çıkış tarihi bugün: son iş günü, hâlâ aktif", st({ termination_date: "2026-10-01" }, "2026-10-01"), "aktif");
eq("çıkış tarihi gelecekte: aktif", st({ termination_date: "2026-12-31" }, "2026-10-01"), "aktif");

// Eski kayıtlar
eq("tarih yok, eski elle 'izinli' korunur", st({ status: "izinli" }, "2026-10-01"), "izinli");
eq("hiçbir şey yok: aktif", st({}, "2026-10-01"), "aktif");

eq("yaklaşan izin notu Türkçe küçük harfle yazılır (i̇ değil i)", shortNote(effectiveStatus(p(izin), "2026-10-01")), "Yaklaşan izin: 25.10.2026 – 29.10.2026");
eq("devam eden izin notu", shortNote(effectiveStatus(p(izin), "2026-10-26")), "İzin: 29.10.2026 tarihinde dönüyor");
eq("addDays ay sonunu aşar", addDays("2026-10-30", 5), "2026-11-04");
eq("addDays yıl sonunu aşar", addDays("2026-12-30", 3), "2027-01-02");

console.log(`\n${pass}/${pass + fail} geçti`);
process.exit(fail === 0 ? 0 : 1);
