import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarSearch, ChevronLeft, ChevronRight, MessageSquare, Truck } from "lucide-react";
import { MachineDaily, type DailyMachine, type ExcludedMachine } from "@/components/machines/machine-daily";
import { MachineMatrix } from "@/components/machines/machine-matrix";
import { MachineRegistry } from "@/components/machines/machine-registry";
import { machineSubtitle } from "@/lib/machines/labels";
import { MachineRental, type RentalMachine } from "@/components/machines/machine-rental";
import { buildHref } from "@/components/cash/range-filter";
import { getAuthUserId, requireUser } from "@/lib/auth/session";
import { getIncomeAllocations, listCategories } from "@/lib/cash/queries";
import { incomeShortLabel, toIncomeSources } from "@/lib/cash/sources";
import { formatDate, formatNumber } from "@/lib/format";
import { getMachineOwners, getMonthMachineData, listDayAttendance, listMachines, listMonthRentalPayments } from "@/lib/machines/queries";
import { MACHINE_TYPE_LABELS, machineWorkable } from "@/lib/machines/schemas";
import { addDays, todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "İş Makineleri — Şantiye Ön Muhasebe" };

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = [
  { key: "gunluk", label: "Günlük Gelenler" },
  { key: "gelenler", label: "Tarihe Göre Liste" },
  { key: "aylik", label: "Aylık Özet" },
  { key: "kira", label: "Kira Ödemeleri" },
  { key: "makineler", label: "Makineler" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * İş Makineleri: kepçe, ekskavatör, kamyon… için günlük puantaj (gün + isteğe bağlı saat), aylık özet ve kira ödemesi.
 * Şantiye bazlı VE ortağa özel (RLS): ortak yalnızca kendi makinelerini görür/yazar; admin her ortağı ayrı ayrı salt okur.
 */
export default async function MachinesPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ gorunum?: string; tarih?: string; ay?: string; ortak?: string }>;
}) {
  const { siteId: rawId } = await params;
  const sp = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const today = todayInIstanbul();
  const base = `/sites/${siteId}/makine`;
  const view: ViewKey = VIEWS.find((v) => v.key === sp.gorunum)?.key ?? "gunluk";
  const currentYm = today.slice(0, 7);
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ay ?? "") && sp.ay! <= currentYm ? sp.ay! : currentYm;
  const [y, m] = ym.split("-").map(Number);
  const firstDay = `${ym}-01`;
  const lastDay = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.tarih ?? "") && sp.tarih! <= today ? sp.tarih! : today;

  const uid = await getAuthUserId(); // JWT'den yerel okunur (ağ turu yok)
  if (!uid) notFound();

  // Ortak için tek tur: veri, kimlik doğrulamayla birlikte (paralel) istenir. Admin yalnızca seçtiği ortağı görür.
  const requested = sp.ortak && UUID.test(sp.ortak) ? sp.ortak : uid;
  // Günlük ekranda gösterilen günün ayı, diğerlerinde seçili ay (işaret kaldırma onayında o ayın kira ödemeleri sayılır)
  const payMonth = view === "gunluk" ? date.slice(0, 7) : ym;
  const fetchFor = (ownerId: string) =>
    Promise.all([
      listMachines(siteId, ownerId),
      view === "gunluk" || view === "gelenler" ? listDayAttendance(siteId, ownerId, date) : Promise.resolve(null),
      view === "aylik" || view === "kira" ? getMonthMachineData(siteId, ownerId, firstDay, lastDay) : Promise.resolve(null),
      view === "kira" || view === "gunluk" || view === "aylik" ? listMonthRentalPayments(siteId, ownerId, payMonth) : Promise.resolve(null),
    ]);
  const [profile, role, owners, firstFetch, allocations, categories] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    getMachineOwners(siteId),
    fetchFor(requested),
    view === "kira" ? getIncomeAllocations(siteId, null, null) : Promise.resolve(null),
    view === "kira" ? listCategories(siteId) : Promise.resolve(null),
  ]);

  const isAdmin = profile.role === "admin";
  const ownerId = isAdmin ? (sp.ortak && UUID.test(sp.ortak) ? sp.ortak : (owners[0]?.id ?? uid)) : uid;
  const [machines, dayEntries, monthData, rentalPayments] = ownerId === requested ? firstFetch : await fetchFor(ownerId);
  const canWrite = canWriteRole(role);
  const ownerName = owners.find((o) => o.id === ownerId)?.name;
  const paidByMachine: Record<number, { count: number; amount: number }> = {};
  for (const p of rentalPayments ?? []) {
    const cur = paidByMachine[p.machineId] ?? { count: 0, amount: 0 };
    paidByMachine[p.machineId] = { count: cur.count + 1, amount: cur.amount + p.amount };
  }

  // Bağlantılar: admin'de seçili ortak korunur
  const keepOwner = isAdmin ? { ortak: ownerId } : {};
  const href = (extra: Record<string, string | undefined>) => buildHref(base, { ...keepOwner, ...extra });

  const tabs = (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div role="tablist" aria-label="Görünüm" className="inline-flex rounded-lg bg-muted p-1">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={href({ gorunum: v.key === "gunluk" ? undefined : v.key })}
            role="tab"
            aria-selected={v.key === view}
            className={cn("inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-4 text-sm font-medium", v.key === view ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {v.label}
          </Link>
        ))}
      </div>
    </div>
  );

  const ownerPicker = isAdmin ? (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Her ortağın makineleri ayrıdır. Salt görüntüleme.</p>
      {owners.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Bu şantiyede henüz makine kaydı yok.</p>
      ) : (
        <nav aria-label="Ortak seç" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="inline-flex rounded-lg bg-muted p-1">
            {owners.map((o) => (
              <Link
                key={o.id}
                href={buildHref(base, { ortak: o.id, gorunum: view === "gunluk" ? undefined : view, tarih: sp.tarih, ay: sp.ay })}
                scroll={false}
                aria-current={o.id === ownerId ? "true" : undefined}
                className={cn("inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3.5 text-sm font-medium", o.id === ownerId ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {o.name}
              </Link>
            ))}
          </div>
        </nav>
      )}
      {ownerName && <p className="text-sm font-medium">{ownerName}</p>}
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">Bu şantiyede yalnızca sizin eklediğiniz makineler; diğer ortakların makineleri sizden ayrıdır.</p>
  );

  /** Gün gezgini (Günlük ve Tarihe Göre Liste): önceki/sonraki gün, tarih seçici, "Bugün". */
  const dateNav = () => {
    const prev = addDays(date, -1);
    const next = addDays(date, 1);
    const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("tr-TR", { weekday: "long", timeZone: "UTC" });
    const g = view === "gunluk" ? undefined : view;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ gorunum: g, tarih: prev })} aria-label="Önceki gün" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
          <form method="get" action={base} className="flex items-center gap-2">
            {g && <input type="hidden" name="gorunum" value={g} />}
            {isAdmin && <input type="hidden" name="ortak" value={ownerId} />}
            <input type="date" name="tarih" defaultValue={date} max={today} required aria-label="Tarih seç" className="h-11 rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm" />
            <button type="submit" className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
              <CalendarSearch className="size-4" aria-hidden />
              Listele
            </button>
          </form>
          {next <= today ? (
            <Link href={href({ gorunum: g, tarih: next })} aria-label="Sonraki gün" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          ) : (
            <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-lg border opacity-40">
              <ChevronRight className="size-5" />
            </span>
          )}
          {date !== today && (
            <Link href={href({ gorunum: g })} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary">
              Bugün
            </Link>
          )}
        </div>
        <h2 className="text-sm font-semibold">
          {formatDate(date)} <span className="font-normal capitalize text-muted-foreground">{weekday}</span>
        </h2>
      </div>
    );
  };

  /** Ay gezgini (Aylık Özet ve Kira Ödemeleri). */
  const monthNav = () => {
    const prev = shiftMonth(ym, -1);
    const next = shiftMonth(ym, 1);
    return (
      <div className="flex items-center gap-2">
        <Link href={href({ gorunum: view, ay: prev })} aria-label="Önceki ay" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <p className="min-w-40 text-center font-semibold">
          {MONTHS[m - 1]} {y}
        </p>
        {next <= currentYm ? (
          <Link href={href({ gorunum: view, ay: next })} aria-label="Sonraki ay" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
            <ChevronRight className="size-5" aria-hidden />
          </Link>
        ) : (
          <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-lg border opacity-40">
            <ChevronRight className="size-5" />
          </span>
        )}
        {ym !== currentYm && (
          <Link href={href({ gorunum: view })} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary">
            Bu ay
          </Link>
        )}
      </div>
    );
  };

  let body: React.ReactNode = null;

  if (view === "gunluk") {
    const entries = dayEntries ?? {};
    const list: DailyMachine[] = [];
    const excluded: ExcludedMachine[] = [];
    for (const mc of machines) {
      const a = machineWorkable(mc, date);
      const present = !!entries[mc.id];
      if (a.workable && (mc.status !== "left" || present || mc.end_date)) list.push(mc);
      else if (present) list.push({ ...mc, warning: a.reason ?? "Şantiyeden ayrıldı olarak işaretli" });
      else excluded.push({ id: mc.id, name: mc.name, reason: a.reason ?? "Şantiyeden ayrıldı" });
    }
    body = (
      <>
        {dateNav()}
        <MachineDaily key={`${ownerId}|${date}`} siteId={siteId} date={date} machines={list} excluded={excluded} initial={entries} paid={paidByMachine} canWrite={canWrite} />
      </>
    );
  } else if (view === "gelenler") {
    const entries = dayEntries ?? {};
    const came = machines.filter((mc) => entries[mc.id]).sort((a, b) => a.name.localeCompare(b.name, "tr"));
    const totalHours = came.reduce((s, mc) => s + (entries[mc.id]?.hours ?? 0), 0);
    body = (
      <>
        {dateNav()}
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{came.length}</span> / {machines.length} makine geldi
          {totalHours > 0 && <> · toplam <span className="font-semibold text-foreground">{formatNumber(totalHours)}</span> saat</>}
        </p>
        {came.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Bu tarihte makine puantaj kaydı yok.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card" aria-label="O gün gelen makineler">
            {came.map((mc, i) => {
              const e = entries[mc.id]!;
              return (
                <li key={mc.id} className="flex min-h-14 items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{mc.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[MACHINE_TYPE_LABELS[mc.machine_type], mc.identifier, machineSubtitle(mc)].filter(Boolean).join(" · ")}</span>
                    {e.note && (
                      <span className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span className="break-words">{e.note}</span>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{e.hours != null ? `${formatNumber(e.hours)} saat` : "—"}</span>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  } else if (view === "aylik") {
    body = (
      <>
        {monthNav()}
        <MachineMatrix
          key={`${ownerId}|${ym}`}
          siteId={siteId}
          ym={ym}
          today={today}
          machines={machines}
          data={monthData ?? {}}
          paid={paidByMachine}
          canWrite={canWrite}
          dayBase={base}
          ownerId={isAdmin ? ownerId : undefined}
        />
      </>
    );
  } else if (view === "kira") {
    const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
    const incomeLabels = Object.fromEntries((allocations ?? []).map((a) => [a.id, incomeShortLabel(a, catName)]));
    const data = monthData ?? {};
    const rentalMachines: RentalMachine[] = machines
      .filter((mc) => mc.ownership === "rented" && mc.rate_unit && mc.rental_rate !== null)
      .map((mc) => {
        const days = Object.values(data[mc.id] ?? {});
        const unit = mc.rate_unit!;
        return {
          id: mc.id,
          name: mc.name,
          supplier: mc.supplier,
          unit,
          rate: mc.rental_rate!,
          worked: unit === "day" ? days.length : Math.round(days.reduce((s, d) => s + (d.hours ?? 0), 0) * 10) / 10,
          daysWithoutHours: unit === "hour" ? days.filter((d) => d.hours === null).length : 0,
        };
      });
    body = (
      <>
        {monthNav()}
        <MachineRental
          key={`${ownerId}|${ym}`}
          siteId={siteId}
          ym={ym}
          canWrite={canWrite}
          today={today}
          machines={rentalMachines}
          payments={rentalPayments ?? []}
          incomeSources={toIncomeSources(allocations ?? [], catName)}
          incomeLabels={incomeLabels}
        />
      </>
    );
  } else {
    body = <MachineRegistry siteId={siteId} machines={machines} canWrite={canWrite} />;
  }

  return (
    <div className={cn("space-y-4", view === "aylik" ? "max-w-full" : "max-w-3xl")}>
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Truck className="size-5 text-muted-foreground" aria-hidden />
        İş Makineleri
      </h1>
      {ownerPicker}
      {(!isAdmin || owners.length > 0) && (
        <>
          {tabs}
          {body}
        </>
      )}
    </div>
  );
}
