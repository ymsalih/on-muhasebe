import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarSearch, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { DailyAttendance, type DailyPerson, type ExcludedPerson, type PresentMeta } from "@/components/attendance/daily-attendance";
import { MonthlyMatrix } from "@/components/attendance/monthly-matrix";
import { WagePayments } from "@/components/attendance/wage-payments";
import { requireUser } from "@/lib/auth/session";
import { getMonthData, listAttendancePeople, listPresent } from "@/lib/attendance/queries";
import { getIncomeAllocations, listCategories } from "@/lib/cash/queries";
import { incomeShortLabel, toIncomeSources } from "@/lib/cash/sources";
import { listMonthWagePayments } from "@/lib/personnel/payments";
import { addDays, workAvailability, todayInIstanbul } from "@/lib/personnel/status";
import { formatDate } from "@/lib/format";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Puantaj — ÖZN YOL" };

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Puantaj (CLAUDE.md 7.3-E): Günlük Gelenler, Tarihe Göre Liste, Aylık Özet ve Maaş Ödemeleri sekmeleri. */
export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ gorunum?: string; tarih?: string; ay?: string }>;
}) {
  const { siteId: rawId } = await params;
  const sp = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const today = todayInIstanbul();
  const monthly = sp.gorunum === "aylik";
  const attendees = sp.gorunum === "gelenler";
  const wages = sp.gorunum === "maas";
  const view = monthly ? "aylik" : attendees ? "gelenler" : wages ? "maas" : "gunluk";
  const base = `/sites/${siteId}/puantaj`;

  const tabs = (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
    <div role="tablist" aria-label="Görünüm" className="inline-flex rounded-lg bg-muted p-1">
      {(
        [
          ["gunluk", "Günlük Gelenler", base],
          ["gelenler", "Tarihe Göre Liste", `${base}?gorunum=gelenler`],
          ["aylik", "Aylık Özet", `${base}?gorunum=aylik`],
          ["maas", "Maaş Ödemeleri", `${base}?gorunum=maas`],
        ] as const
      ).map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          role="tab"
          aria-selected={key === view}
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-4 text-sm font-medium",
            key === view ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </div>
    </div>
  );

  const currentYm = today.slice(0, 7);
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ay ?? "") && sp.ay! <= currentYm ? sp.ay! : currentYm;
  const [y, m] = ym.split("-").map(Number);
  const last = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.tarih ?? "") && sp.tarih! <= today ? sp.tarih! : today;

  // Görünüme göre gereken TÜM veri, kimlik doğrulamayla birlikte (paralel) istenir; art arda beklemek her geçişe
  // bir ağ turu daha ekler.
  const [, people, role, monthData, presentRows, wagePayments, allocations, categories] = await Promise.all([
    requireUser(),
    listAttendancePeople(siteId),
    getSiteRole(siteId),
    monthly || wages ? getMonthData(siteId, `${ym}-01`, last) : Promise.resolve(null),
    monthly || wages ? Promise.resolve(null) : listPresent(siteId, date),
    wages ? listMonthWagePayments(siteId, ym) : Promise.resolve(null),
    wages ? getIncomeAllocations(siteId, null, null) : Promise.resolve(null),
    wages ? listCategories(siteId) : Promise.resolve(null),
  ]);

  // Ay gezgini (Aylık Özet ve Maaş Ödemeleri ortak): önceki/sonraki ay, "Bu ay"
  const monthNav = (hrefFor: (v: string) => string, resetHref: string) => {
    const prev = shiftMonth(ym, -1);
    const next = shiftMonth(ym, 1);
    return (
      <div className="flex items-center gap-2">
        <Link href={hrefFor(prev)} aria-label="Önceki ay" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <p className="min-w-40 text-center font-semibold">
          {MONTHS[m - 1]} {y}
        </p>
        {next <= currentYm ? (
          <Link href={hrefFor(next)} aria-label="Sonraki ay" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
            <ChevronRight className="size-5" aria-hidden />
          </Link>
        ) : (
          <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-lg border opacity-40">
            <ChevronRight className="size-5" />
          </span>
        )}
        {ym !== currentYm && (
          <Link href={resetHref} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary">
            Bu ay
          </Link>
        )}
      </div>
    );
  };

  // ---------------- Aylık Özet ----------------
  if (monthly) {
    return (
      <div className="max-w-full space-y-4">
        <h1 className="text-xl font-semibold">Puantaj</h1>
        {tabs}
        {monthNav((v) => `${base}?gorunum=aylik&ay=${v}`, `${base}?gorunum=aylik`)}
        <MonthlyMatrix siteId={siteId} ym={ym} today={today} people={people} data={monthData!} canWrite={canWriteRole(role)} />
      </div>
    );
  }

  // ---------------- Maaş Ödemeleri: o ay çalışılan gün × günlük ücret; ödeme kasaya "İşçilik" gideri olarak düşer ----------------
  if (wages) {
    const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
    const incomeLabels = Object.fromEntries((allocations ?? []).map((a) => [a.id, incomeShortLabel(a, catName)]));
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold">Puantaj</h1>
        {tabs}
        {monthNav((v) => `${base}?gorunum=maas&ay=${v}`, `${base}?gorunum=maas`)}
        <WagePayments
          key={ym}
          siteId={siteId}
          ym={ym}
          canWrite={canWriteRole(role)}
          today={today}
          people={people.map((p) => ({ id: p.id, name: p.full_name, dailyWage: p.daily_wage === null ? null : Number(p.daily_wage), days: monthData!.totals.get(p.id) ?? 0 }))}
          payments={wagePayments!}
          incomeSources={toIncomeSources(allocations ?? [], catName)}
          incomeLabels={incomeLabels}
        />
      </div>
    );
  }

  // ---------------- Tarihe Göre Liste: seçilen günde kimler geldi (salt okunur analiz listesi) ----------------
  if (attendees) {
    const rows = presentRows!;
    const byId = new Map(people.map((p) => [p.id, p]));
    const came = rows
      .map((r) => ({ ...r, person: byId.get(r.personnelId) }))
      .filter((r) => r.person)
      .sort((a, b) => a.person!.full_name.localeCompare(b.person!.full_name, "tr"));
    const dayHref = (d: string) => `${base}?gorunum=gelenler&tarih=${d}`;
    const prevDay = addDays(date, -1);
    const nextDay = addDays(date, 1);
    const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
    const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("tr-TR", { weekday: "long", timeZone: "UTC" });

    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold">Puantaj</h1>
        {tabs}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={dayHref(prevDay)} aria-label="Önceki gün" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
          <form method="get" action={base} className="flex items-center gap-2">
            <input type="hidden" name="gorunum" value="gelenler" />
            <input
              type="date"
              name="tarih"
              defaultValue={date}
              max={today}
              required
              aria-label="Tarih seç"
              className="h-11 rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm"
            />
            <button type="submit" className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
              <CalendarSearch className="size-4" aria-hidden />
              Listele
            </button>
          </form>
          {nextDay <= today ? (
            <Link href={dayHref(nextDay)} aria-label="Sonraki gün" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          ) : (
            <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-lg border opacity-40">
              <ChevronRight className="size-5" />
            </span>
          )}
          {date !== today && (
            <Link href={`${base}?gorunum=gelenler`} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary">
              Bugün
            </Link>
          )}
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">
            {formatDate(date)} <span className="font-normal capitalize text-muted-foreground">{weekday}</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{came.length}</span> / {people.length} kişi geldi
          </p>
        </div>

        {came.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Bu tarihte puantaj kaydı yok.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card" aria-label="O gün gelenler">
            {came.map((r, i) => (
              <li key={r.personnelId}>
                <Link href={`/sites/${siteId}/personel/${r.personnelId}`} className="flex min-h-14 items-start gap-3 px-4 py-2.5 hover:bg-muted/50">
                  <span className="mt-0.5 w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.person!.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[r.person!.duty ?? r.person!.job, r.markedBy && `${r.markedBy} işaretledi · ${fmtTime(r.markedAt)}`].filter(Boolean).join(" · ")}
                    </span>
                    {r.note && (
                      <span className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span className="break-words">{r.note}</span>
                      </span>
                    )}
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ---------------- Günlük Gelenler ----------------
  const dailyRows = presentRows!;
  const present = new Set(dailyRows.map((r) => r.personnelId));
  const presentMeta: PresentMeta[] = dailyRows.map((r) => ({ id: r.personnelId, note: r.note, markedBy: r.markedBy, markedAt: r.markedAt }));

  const list: DailyPerson[] = [];
  const excluded: ExcludedPerson[] = [];
  for (const p of people) {
    const a = workAvailability(p, date);
    const base_ = { id: p.id, full_name: p.full_name, job: p.job, duty: p.duty };
    if (a.workable) list.push(base_);
    else if (present.has(p.id)) list.push({ ...base_, warning: a.reason ?? undefined }); // işaretli kalır, kullanıcı uyarılır
    else excluded.push({ id: p.id, full_name: p.full_name, reason: a.reason ?? "" });
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Puantaj</h1>
      {tabs}
      <DailyAttendance
        key={date}
        siteId={siteId}
        date={date}
        today={today}
        people={list}
        excluded={excluded}
        initialPresent={presentMeta}
        canWrite={canWriteRole(role)}
      />
    </div>
  );
}
