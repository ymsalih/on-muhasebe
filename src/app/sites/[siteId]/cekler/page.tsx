import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlarmClock, ArrowDownLeft, ArrowUpRight, FileCheck2, TriangleAlert } from "lucide-react";
import { buildHref } from "@/components/cash/range-filter";
import { ChequeBoard } from "@/components/cheques/cheque-board";
import { TabStrip } from "@/components/reports/tab-strip";
import { getAuthUserId, requireUser } from "@/lib/auth/session";
import {
  CHEQUE_VIEWS,
  CHEQUE_VIEW_LABELS,
  CHEQUE_LIST_LIMIT,
  getChequeOwners,
  getChequeSuggestions,
  getChequeSummary,
  listCheques,
  type ChequeView,
} from "@/lib/cheques/queries";
import { ALERT_DAYS, CHEQUE_DIRECTION_LABELS, type ChequeDirection } from "@/lib/cheques/schemas";
import { formatCurrency } from "@/lib/format";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Çekler — ÖZN YOL" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY: Record<ChequeView, string> = {
  bekleyen: "Bekleyen çek yok.",
  yaklasan: `Önümüzdeki ${ALERT_DAYS} gün içinde vadesi gelen çek yok.`,
  gecmis: "Vadesi geçmiş çek yok.",
  tamam: "Henüz tahsil edilen / ödenen çek yok.",
  diger: "Karşılıksız çıkan veya iptal edilen çek yok.",
  hepsi: "Henüz çek eklenmedi.",
};

/**
 * Çekler: alınan (tahsil edilecek) ve verilen (ödenecek) çeklerin vade tarihi, tutarı ve kimden/kime bilgisi. Vadesi geçmiş ve
 * 7 gün içinde gelenler ana sayfada uyarı olarak görünür. Her ortağın çekleri KENDİNE özeldir (RLS): ortak yalnızca kendininkini
 * görür/yazar; admin her ortağı ayrı ayrı salt okur. Kasadan bağımsızdır.
 */
export default async function ChequesPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ durum?: string; yon?: string; ortak?: string }>;
}) {
  const { siteId: rawId } = await params;
  const sp = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const today = todayInIstanbul();
  const base = `/sites/${siteId}/cekler`;
  const view: ChequeView = CHEQUE_VIEWS.find((v) => v === sp.durum) ?? "bekleyen";
  const direction: ChequeDirection | null = sp.yon === "received" || sp.yon === "given" ? sp.yon : null;

  const uid = await getAuthUserId(); // JWT'den yerel okunur (ağ turu yok)
  if (!uid) notFound();

  // Tek tur: veri, kimlik doğrulamayla birlikte (paralel) istenir. Admin yalnızca seçtiği ortağı görür.
  const requested = sp.ortak && UUID.test(sp.ortak) ? sp.ortak : uid;
  const fetchFor = (ownerId: string) =>
    Promise.all([listCheques(siteId, ownerId, view, direction, today), getChequeSummary(siteId, ownerId), getChequeSuggestions(siteId, ownerId)]);
  const [profile, role, owners, first] = await Promise.all([requireUser(), getSiteRole(siteId), getChequeOwners(siteId), fetchFor(requested)]);

  const isAdmin = profile.role === "admin";
  const ownerId = isAdmin ? (sp.ortak && UUID.test(sp.ortak) ? sp.ortak : (owners[0]?.id ?? uid)) : uid;
  const [list, summary, suggestions] = ownerId === requested ? first : await fetchFor(ownerId);
  const canWrite = canWriteRole(role);

  const keepOwner = isAdmin ? { ortak: ownerId } : {};
  const link = (extra: Record<string, string | undefined>) => buildHref(base, { ...keepOwner, durum: view === "bekleyen" ? undefined : view, yon: direction ?? undefined, ...extra });

  const cards = [
    {
      label: "Bekleyen alınan",
      value: formatCurrency(summary.receivedTotal),
      sub: `${summary.receivedCount} çek · tahsil edilecek`,
      icon: ArrowDownLeft,
      tone: "text-emerald-700 dark:text-emerald-400",
      testid: "card-received",
    },
    {
      label: "Bekleyen verilen",
      value: formatCurrency(summary.givenTotal),
      sub: `${summary.givenCount} çek · ödenecek`,
      icon: ArrowUpRight,
      tone: "text-orange-700 dark:text-orange-400",
      testid: "card-given",
    },
    {
      label: `${ALERT_DAYS} gün içinde`,
      value: `${summary.soonCount} çek`,
      sub: `Alınacak ${formatCurrency(summary.soonReceived)} · Ödenecek ${formatCurrency(summary.soonGiven)}`,
      icon: AlarmClock,
      tone: summary.soonCount > 0 ? "text-amber-700 dark:text-amber-300" : "",
      testid: "card-soon",
    },
    {
      label: "Vadesi geçmiş",
      value: `${summary.overdueCount} çek`,
      sub: `Alınacak ${formatCurrency(summary.overdueReceived)} · Ödenecek ${formatCurrency(summary.overdueGiven)}`,
      icon: TriangleAlert,
      tone: summary.overdueCount > 0 ? "text-red-600 dark:text-red-400" : "",
      testid: "card-overdue",
    },
  ];

  const ownerPicker = isAdmin ? (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Her ortağın çekleri ayrıdır. Salt görüntüleme.</p>
      {owners.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Bu şantiyede henüz çek kaydı yok.</p>
      ) : (
        <nav aria-label="Ortak seç" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="inline-flex rounded-lg bg-muted p-1">
            {owners.map((o) => (
              <Link
                key={o.id}
                href={buildHref(base, { ortak: o.id })}
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
    <p className="text-sm text-muted-foreground">Yalnızca sizin çekleriniz; diğer ortakların çekleri sizden ayrıdır. Genel kasadan bağımsızdır.</p>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <FileCheck2 className="size-5 text-muted-foreground" aria-hidden />
        Çekler
      </h1>
      {ownerPicker}
      {(!isAdmin || owners.length > 0) && (
        <>
          <section aria-label="Çek özeti" className="grid grid-cols-2 gap-2 sm:gap-3">
            {cards.map(({ label, value, sub, icon: Icon, tone, testid }) => (
              <div key={label} className="min-w-0 rounded-xl border bg-card p-3 sm:p-4" data-testid={testid}>
                <div className="mb-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0">{label}</span>
                </div>
                <p className={cn("break-words text-base font-semibold tabular-nums sm:text-xl", tone)}>{value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
              </div>
            ))}
          </section>

          <TabStrip label="Çek görünümleri">
            {CHEQUE_VIEWS.map((v) => (
              <Link
                key={v}
                href={link({ durum: v === "bekleyen" ? undefined : v })}
                scroll={false}
                aria-current={view === v ? "page" : undefined}
                className={cn("inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3.5 text-sm font-medium", view === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {CHEQUE_VIEW_LABELS[v]}
              </Link>
            ))}
          </TabStrip>

          <nav aria-label="Çek türü süzgeci" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <div className="flex gap-2">
              {([null, "received", "given"] as const).map((d) => (
                <Link
                  key={d ?? "tum"}
                  href={link({ yon: d ?? undefined })}
                  scroll={false}
                  aria-current={direction === d ? "true" : undefined}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium",
                    direction === d ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {d === null ? "Tüm çekler" : CHEQUE_DIRECTION_LABELS[d]}
                </Link>
              ))}
            </div>
          </nav>

          <ChequeBoard
            siteId={siteId}
            canWrite={canWrite}
            today={today}
            rows={list.rows}
            hasMore={list.hasMore || list.rows.length > CHEQUE_LIST_LIMIT}
            suggestions={suggestions}
            emptyText={EMPTY[view]}
          />
        </>
      )}
    </div>
  );
}
