import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { DataRow } from "@/components/data-row";
import { requireUser } from "@/lib/auth/session";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/goods/schemas";
import { ENTRY_LIST_LIMIT, listEntries, type EntryRow } from "@/lib/goods/queries";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "İrsaliye / Fatura — Şantiye Ön Muhasebe" };

const TYPE_BADGE: Record<DocumentType, string> = {
  irsaliye: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400",
  fatura: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400",
  fis: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
};

const NO_PARTY = "Firma belirtilmedi";

function quantityText(e: EntryRow) {
  if (e.quantity === null) return null;
  return `${formatNumber(Number(e.quantity))}${e.unit ? ` ${e.unit}` : ""}`;
}

/** İrsaliye/fatura/fiş listesi (CLAUDE.md Faz 3): varsayılan firma bazlı, isteğe bağlı tarih sırası. */
export default async function GoodsEntriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ gorunum?: string }>;
}) {
  const { siteId: rawId } = await params;
  const { gorunum } = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const profile = await requireUser();
  const [entries, role] = await Promise.all([listEntries(siteId), getSiteRole(siteId, profile.id)]);
  const canWrite = canWriteRole(role);
  const view = gorunum === "tarih" ? "tarih" : "firma";
  const base = `/sites/${siteId}/irsaliye`;

  const renderRow = (e: EntryRow, showParty: boolean) => (
    <DataRow
      key={e.id}
      href={canWrite ? `${base}/${e.id}` : undefined}
      title={e.material_type ?? "Malzeme belirtilmedi"}
      badge={
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", TYPE_BADGE[e.document_type])}>
          {DOCUMENT_TYPE_LABELS[e.document_type]}
        </span>
      }
      lines={[
        [formatDate(e.entry_date), e.document_no && `No: ${e.document_no}`].filter(Boolean).join(" · "),
        [showParty && (e.parties?.name ?? NO_PARTY), e.variant, quantityText(e)].filter(Boolean).join(" · "),
      ]}
      trailing={
        Number(e.transport_cost) > 0 ? (
          <span className="block text-xs text-muted-foreground">
            Nakliye
            <span className="block text-sm font-medium text-foreground">{formatCurrency(Number(e.transport_cost))}</span>
          </span>
        ) : undefined
      }
    />
  );

  const groups = new Map<string, EntryRow[]>();
  if (view === "firma") {
    for (const e of entries) {
      const key = e.parties?.name ?? NO_PARTY;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) =>
    a === NO_PARTY ? 1 : b === NO_PARTY ? -1 : a.localeCompare(b, "tr"),
  );

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">İrsaliye / Fatura</h1>
        {canWrite && (
          <Link
            href={`${base}/yeni`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" aria-hidden />
            Yeni Kayıt
          </Link>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-14 text-center">
          <FileText className="size-10 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">Henüz irsaliye eklenmedi</h2>
          <p className="text-sm text-muted-foreground">
            {canWrite
              ? "Fiş, fatura ve irsaliyelerinizi buraya kaydedin; firma bazında takip edin."
              : "Bu şantiyede henüz kayıt yok. Görüntüleyici olarak kayıt ekleyemezsiniz."}
          </p>
          {canWrite && (
            <Link
              href={`${base}/yeni`}
              className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              <Plus className="size-4" aria-hidden />
              İlk kaydı ekle
            </Link>
          )}
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Görünüm" className="inline-flex rounded-lg bg-muted p-1">
            {(["firma", "tarih"] as const).map((v) => (
              <Link
                key={v}
                href={v === "firma" ? base : `${base}?gorunum=tarih`}
                role="tab"
                aria-selected={view === v}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-md px-4 text-sm font-medium",
                  view === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "firma" ? "Firma bazlı" : "Tarih sırası"}
              </Link>
            ))}
          </div>

          {view === "tarih" ? (
            <div className="divide-y rounded-xl border bg-card">{entries.map((e) => renderRow(e, true))}</div>
          ) : (
            <div className="space-y-3">
              {sortedGroups.map(([name, rows]) => {
                const totalTransport = rows.reduce((sum, r) => sum + Number(r.transport_cost), 0);
                return (
                  <details key={name} open={sortedGroups.length <= 3} className="group rounded-xl border bg-card">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{name}</span>
                        <span className="text-xs text-muted-foreground">{rows.length} kayıt</span>
                      </span>
                      {totalTransport > 0 && (
                        <span className="shrink-0 text-right text-xs text-muted-foreground">
                          Toplam nakliye
                          <span className="block text-sm font-medium text-foreground">{formatCurrency(totalTransport)}</span>
                        </span>
                      )}
                    </summary>
                    <div className="divide-y border-t">{rows.map((e) => renderRow(e, false))}</div>
                  </details>
                );
              })}
            </div>
          )}

          {entries.length >= ENTRY_LIST_LIMIT && (
            <p className="text-center text-xs text-muted-foreground">
              En yeni {ENTRY_LIST_LIMIT} kayıt gösteriliyor.
            </p>
          )}
        </>
      )}
    </div>
  );
}
