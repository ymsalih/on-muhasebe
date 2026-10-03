import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Droplets, Fuel, Wallet } from "lucide-react";
import { FuelEntries } from "@/components/fuel/fuel-entries";
import { RangeFilter, buildHref } from "@/components/cash/range-filter";
import { getAuthUserId, requireUser } from "@/lib/auth/session";
import { resolveRange } from "@/lib/cash/range";
import { formatCurrency, formatNumber } from "@/lib/format";
import { FUEL_LIST_LIMIT, getFuelSuggestions, getFuelSummary, listFuelEntries } from "@/lib/fuel/queries";
import { getMachineOwners, listMachines } from "@/lib/machines/queries";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Yakıt Takibi — Şantiye Ön Muhasebe" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Yakıt takibi: hangi araç, ne zaman, kim aldı, kaç litre, litre fiyatı; en sonda dönemin toplam yakıt tutarı.
 * Her ortağın kayıtları KENDİNE özeldir (RLS, iş makineleri gibi): ortak yalnızca kendi araçlarının yakıtını görür/yazar;
 * admin her ortağı ayrı ayrı salt okur. Genel kasadan bağımsızdır.
 */
export default async function FuelPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ aralik?: string; baslangic?: string; bitis?: string; arac?: string; ortak?: string }>;
}) {
  const { siteId: rawId } = await params;
  const sp = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const today = todayInIstanbul();
  const range = resolveRange(sp.aralik, today, sp.baslangic, sp.bitis);
  const base = `/sites/${siteId}/yakit`;
  const machineParam = /^\d{1,9}$/.test(sp.arac ?? "") ? Number(sp.arac) : null;

  const uid = await getAuthUserId(); // JWT'den yerel okunur (ağ turu yok)
  if (!uid) notFound();

  // Tek tur: veri, kimlik doğrulamayla birlikte (paralel) istenir. Admin yalnızca seçtiği ortağı görür.
  const requested = sp.ortak && UUID.test(sp.ortak) ? sp.ortak : uid;
  const fetchFor = (ownerId: string) =>
    Promise.all([
      listMachines(siteId, ownerId),
      listFuelEntries(siteId, ownerId, range.from, range.to, machineParam),
      getFuelSummary(siteId, ownerId, range.from, range.to, machineParam),
      getFuelSuggestions(siteId, ownerId),
    ]);
  const [profile, role, owners, firstFetch] = await Promise.all([requireUser(), getSiteRole(siteId), getMachineOwners(siteId), fetchFor(requested)]);

  const isAdmin = profile.role === "admin";
  const ownerId = isAdmin ? (sp.ortak && UUID.test(sp.ortak) ? sp.ortak : (owners[0]?.id ?? uid)) : uid;
  const [machines, list, summary, suggestions] = ownerId === requested ? firstFetch : await fetchFor(ownerId);
  const canWrite = canWriteRole(role);
  const machine = machineParam !== null ? machines.find((m) => m.id === machineParam) : undefined;
  const selected = machine?.id ?? null;

  const totals = {
    count: summary.reduce((s, r) => s + r.count, 0),
    liters: Math.round(summary.reduce((s, r) => s + r.liters, 0) * 100) / 100,
    total: Math.round(summary.reduce((s, r) => s + r.total, 0) * 100) / 100,
  };
  const avgPrice = totals.liters > 0 ? totals.total / totals.liters : null;

  const rangeParams = {
    aralik: range.key === "ay" ? undefined : range.key,
    baslangic: range.key === "ozel" ? range.from : undefined,
    bitis: range.key === "ozel" ? range.to : undefined,
  };
  const keepOwner = isAdmin ? { ortak: ownerId } : {};
  const keep = { ...keepOwner, arac: selected !== null ? String(selected) : undefined };

  const cards = [
    { label: "Toplam yakıt tutarı", value: formatCurrency(totals.total), icon: Wallet, tone: "text-orange-700 dark:text-orange-400" },
    { label: "Toplam litre", value: `${formatNumber(totals.liters)} L`, icon: Droplets, tone: "text-foreground" },
    { label: "Ort. litre fiyatı", value: avgPrice === null ? "—" : formatCurrency(avgPrice), icon: Fuel, tone: "text-foreground" },
  ];

  const ownerPicker = isAdmin ? (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Her ortağın yakıt kayıtları ayrıdır. Salt görüntüleme.</p>
      {owners.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Bu şantiyede henüz araç kaydı yok.</p>
      ) : (
        <nav aria-label="Ortak seç" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="inline-flex rounded-lg bg-muted p-1">
            {owners.map((o) => (
              <Link
                key={o.id}
                href={buildHref(base, { ortak: o.id, ...rangeParams })}
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
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">Yalnızca sizin araçlarınızın yakıt kayıtları; diğer ortakların kayıtları sizden ayrıdır. Genel kasadan bağımsızdır.</p>
  );

  const chip = (label: string, id: number | null) => (
    <Link
      key={id ?? "tum"}
      href={buildHref(base, { ...keepOwner, ...rangeParams, arac: id === null ? undefined : String(id) })}
      scroll={false}
      aria-current={selected === id ? "true" : undefined}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium",
        selected === id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Fuel className="size-5 text-muted-foreground" aria-hidden />
        Yakıt Takibi
      </h1>
      {ownerPicker}
      {(!isAdmin || owners.length > 0) && (
        <>
          <RangeFilter base={base} range={range} keep={keep} />

          {machines.length > 1 && (
            <nav aria-label="Araç süzgeci" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
              <div className="flex gap-2">
                {chip("Tüm araçlar", null)}
                {machines.map((m) => chip(m.identifier ? `${m.name} · ${m.identifier}` : m.name, m.id))}
              </div>
            </nav>
          )}

          <section aria-label="Yakıt toplamları" className="grid grid-cols-3 gap-2 sm:gap-3">
            {cards.map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0">{label}</span>
                </div>
                <p className={cn("break-words text-sm font-semibold tabular-nums sm:text-xl", tone)}>{value}</p>
              </div>
            ))}
          </section>

          {selected === null && summary.length > 1 && (
            <section className="space-y-2" aria-label="Araç bazında yakıt">
              <h2 className="text-sm font-semibold">Araç bazında</h2>
              <ul className="divide-y rounded-xl border bg-card">
                {summary.map((r) => {
                  const pct = totals.total > 0 ? Math.round((r.total / totals.total) * 100) : 0;
                  return (
                    <li key={r.machineId}>
                      <Link href={buildHref(base, { ...keepOwner, ...rangeParams, arac: String(r.machineId) })} scroll={false} className="block min-h-14 px-4 py-3 hover:bg-muted/50">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-medium">{r.name}</span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(r.total)}</span>
                        </span>
                        <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span className="block h-full rounded-full bg-orange-500" style={{ width: `${Math.max(2, pct)}%` }} />
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {r.count} alım · {formatNumber(r.liters)} L · %{pct}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <FuelEntries
            siteId={siteId}
            canWrite={canWrite}
            today={today}
            entries={list.rows}
            hasMore={list.hasMore || list.rows.length > FUEL_LIST_LIMIT}
            machines={machines.map((m) => ({ id: m.id, name: m.name, identifier: m.identifier }))}
            defaultMachineId={selected}
            suggestions={suggestions}
            totals={totals}
          />
        </>
      )}
    </div>
  );
}
