import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DailyAttendance, type DailyPerson, type ExcludedPerson, type PresentMeta } from "@/components/attendance/daily-attendance";
import { MonthlyMatrix } from "@/components/attendance/monthly-matrix";
import { requireUser } from "@/lib/auth/session";
import { getMonthData, listAttendancePeople, listPresent } from "@/lib/attendance/queries";
import { workAvailability, todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Puantaj — Şantiye Ön Muhasebe" };

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Puantaj (CLAUDE.md 7.3-E): Günlük Gelenler + Aylık Özet sekmeleri. */
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

  const profile = await requireUser();
  const today = todayInIstanbul();
  const monthly = sp.gorunum === "aylik";
  const base = `/sites/${siteId}/puantaj`;

  const tabs = (
    <div role="tablist" aria-label="Görünüm" className="inline-flex rounded-lg bg-muted p-1">
      {(
        [
          ["gunluk", "Günlük Gelenler", base],
          ["aylik", "Aylık Özet", `${base}?gorunum=aylik`],
        ] as const
      ).map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          role="tab"
          aria-selected={(key === "aylik") === monthly}
          className={cn(
            "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium",
            (key === "aylik") === monthly ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );

  const [people, role] = await Promise.all([listAttendancePeople(siteId), getSiteRole(siteId, profile.id)]);

  // ---------------- Aylık Özet ----------------
  if (monthly) {
    const currentYm = today.slice(0, 7);
    const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ay ?? "") && sp.ay! <= currentYm ? sp.ay! : currentYm;
    const [y, m] = ym.split("-").map(Number);
    const last = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const data = await getMonthData(siteId, `${ym}-01`, last);
    const prev = shiftMonth(ym, -1);
    const next = shiftMonth(ym, 1);
    const monthHref = (v: string) => `${base}?gorunum=aylik&ay=${v}`;

    return (
      <div className="max-w-full space-y-4">
        <h1 className="text-xl font-semibold">Puantaj</h1>
        {tabs}
        <div className="flex items-center gap-2">
          <Link href={monthHref(prev)} aria-label="Önceki ay" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
          <p className="min-w-40 text-center font-semibold">
            {MONTHS[m - 1]} {y}
          </p>
          {next <= currentYm ? (
            <Link href={monthHref(next)} aria-label="Sonraki ay" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          ) : (
            <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-lg border opacity-40">
              <ChevronRight className="size-5" />
            </span>
          )}
          {ym !== currentYm && (
            <Link href={`${base}?gorunum=aylik`} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary">
              Bu ay
            </Link>
          )}
        </div>
        <MonthlyMatrix siteId={siteId} ym={ym} today={today} people={people} data={data} canWrite={canWriteRole(role)} />
      </div>
    );
  }

  // ---------------- Günlük Gelenler ----------------
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.tarih ?? "") && sp.tarih! <= today ? sp.tarih! : today;
  const presentRows = await listPresent(siteId, date);
  const present = new Set(presentRows.map((r) => r.personnelId));
  const presentMeta: PresentMeta[] = presentRows.map((r) => ({ id: r.personnelId, note: r.note, markedBy: r.markedBy, markedAt: r.markedAt }));

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
