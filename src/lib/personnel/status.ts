import { formatDate } from "@/lib/format";
import { PERSON_STATUS_LABELS, type PersonStatus } from "@/lib/personnel/schemas";

/**
 * Personelin GÜNCEL durumu, kayıtlı çalışma durumundan ve izin/rapor/geçici görev tarihlerinden türetilir.
 * Kural (tek kaynak — liste, filtre, rozet ve puantaj bunu kullanır):
 *  1. Kayıtlı durum 'ayrildi' ya da işten çıkış tarihi geçmişte ise → Ayrıldı.
 *  2. İzin / rapor / geçici görev başlangıçları tarih sırasına dizilir. Bir dönem, kendinden sonraki dönemin
 *     başlangıcında biter; SON dönem işe dönüş tarihinde biter (dönüş yoksa gün sayısıyla, o da yoksa açık uçlu).
 *     "İşe dönüş tarihi" o gün işe döndüğü anlamındadır: dönüş gününde kişi artık aktiftir.
 *  3. Bugün bir dönemin içindeyse (başlangıç ≤ bugün < bitiş) → o dönemin durumu; değilse Aktif.
 *  4. Başlangıcı gelecekte olan dönem "yaklaşan" olarak bilgi verir; kişi o tarihe kadar Aktif kalır.
 */

export type AbsenceKind = "izinli" | "raporlu" | "gecici_gorevde";

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  izinli: "İzin",
  raporlu: "Rapor",
  gecici_gorevde: "Geçici görev",
};

export type StatusInput = {
  status: PersonStatus;
  termination_date: string | null;
  temp_assignment_start: string | null;
  report_start: string | null;
  leave_start: string | null;
  return_date: string | null;
  absence_days_count: number | null;
};

export type Period = { kind: AbsenceKind; start: string; end: string | null };
export type EffectiveStatus = { status: PersonStatus; current: Period | null; upcoming: Period | null };

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" + gün (UTC, saat dilimi kayması olmaz). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

/** Türkiye'nin bugünü (yyyy-mm-dd), sunucu saat diliminden bağımsız. */
export function todayInIstanbul(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
}

/** En geç başlangıç tarihi (izin, rapor, geçici görev arasında). */
export function latestAbsenceStart(p: Pick<StatusInput, "temp_assignment_start" | "report_start" | "leave_start">): string | null {
  return [p.leave_start, p.report_start, p.temp_assignment_start].filter((d): d is string => !!d).sort().at(-1) ?? null;
}

export function effectiveStatus(p: StatusInput, today: string): EffectiveStatus {
  if (p.status === "ayrildi" || (p.termination_date && p.termination_date < today)) {
    return { status: "ayrildi", current: null, upcoming: null };
  }

  const starts = (
    [
      ["izinli", p.leave_start],
      ["raporlu", p.report_start],
      ["gecici_gorevde", p.temp_assignment_start],
    ] as const
  )
    .filter((entry): entry is readonly [AbsenceKind, string] => !!entry[1])
    .map(([kind, start]) => ({ kind, start }))
    .sort((a, b) => a.start.localeCompare(b.start));

  // Hiç tarih yoksa eski kayıtlardaki elle girilmiş durum korunur.
  if (starts.length === 0) return { status: p.status, current: null, upcoming: null };

  const periods: Period[] = starts.map((s, i) => {
    const next = starts[i + 1];
    let end: string | null = null;
    if (next) end = next.start;
    else if (p.return_date && p.return_date > s.start) end = p.return_date;
    else if (p.absence_days_count && p.absence_days_count > 0) end = addDays(s.start, p.absence_days_count);
    return { ...s, end };
  });

  const current = periods.find((x) => x.start <= today && (x.end === null || today < x.end)) ?? null;
  const upcoming = periods.find((x) => x.start > today) ?? null;
  return { status: current ? current.kind : "aktif", current, upcoming };
}

/** Kullanıcıya gösterilen açıklama cümlesi; null: söylenecek ek bir şey yok. */
export function describeStatus(eff: EffectiveStatus): string | null {
  if (eff.current) {
    const label = ABSENCE_LABELS[eff.current.kind];
    return eff.current.end
      ? `${label} devam ediyor; ${formatDate(eff.current.end)} tarihinde işe dönecek.`
      : `${label} devam ediyor; dönüş tarihi girilmedi.`;
  }
  if (eff.upcoming) {
    const label = ABSENCE_LABELS[eff.upcoming.kind];
    return eff.upcoming.end
      ? `Şu an aktif. ${label} ${formatDate(eff.upcoming.start)} tarihinde başlayacak, ${formatDate(eff.upcoming.end)} tarihinde işe dönecek.`
      : `Şu an aktif. ${label} ${formatDate(eff.upcoming.start)} tarihinde başlayacak.`;
  }
  return null;
}

/** Listede tek satırlık kısa not. */
export function shortNote(eff: EffectiveStatus): string | null {
  if (eff.current) {
    const label = ABSENCE_LABELS[eff.current.kind];
    return eff.current.end ? `${label}: ${formatDate(eff.current.end)} tarihinde dönüyor` : `${label}: dönüş tarihi yok`;
  }
  if (eff.upcoming) {
    return `Yaklaşan ${ABSENCE_LABELS[eff.upcoming.kind].toLocaleLowerCase("tr-TR")}: ${formatDate(eff.upcoming.start)}${eff.upcoming.end ? ` – ${formatDate(eff.upcoming.end)}` : ""}`;
  }
  return null;
}

/** Puantaj listesi için gereken alanlar: durum girdileri + işe giriş tarihi. */
export type WorkInput = StatusInput & { hire_date: string | null };

/**
 * Bir kişi verilen tarihte işe gelebilir mi? Puantajda (Faz 5) listeye girecek personeli belirler.
 * Gelemez: işe girmeden önce, işten çıktıktan sonra, ayrıldı (çıkış tarihi bilinmiyorsa her tarih için),
 * izinli / raporlu / geçici görevde olduğu gün. `reason` kullanıcıya gösterilir.
 * Not: geçmiş bir tarih için de doğru çalışır (dönem o tarihte devam ediyor muydu diye bakar).
 */
export function workAvailability(p: WorkInput, date: string): { workable: boolean; reason: string | null } {
  if (p.hire_date && date < p.hire_date) return { workable: false, reason: "İşe başlamamış" };
  if (p.termination_date && date > p.termination_date) return { workable: false, reason: "Ayrıldı" };
  if (p.status === "ayrildi" && !p.termination_date) return { workable: false, reason: "Ayrıldı" };

  // Çıkış ve kayıtlı durum yukarıda ele alındı; burada yalnızca izin/rapor/geçici görev dönemlerine bakılır.
  const eff = effectiveStatus({ ...p, status: "aktif", termination_date: null }, date);
  if (eff.status !== "aktif") return { workable: false, reason: PERSON_STATUS_LABELS[eff.status] };
  return { workable: true, reason: null };
}
