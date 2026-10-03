import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Search, Users } from "lucide-react";
import { DataRow } from "@/components/data-row";
import { StatusBadge } from "@/components/personnel/status-badge";
import { requireUser } from "@/lib/auth/session";
import { PERSON_STATUSES, PERSON_STATUS_LABELS, type PersonStatus } from "@/lib/personnel/schemas";
import { PERSON_LIST_LIMIT, listPersonnel } from "@/lib/personnel/queries";
import { effectiveStatus, shortNote, todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Personel — ÖZN YOL" };

/** Personel listesi (CLAUDE.md 7.3-H): ad soyad, işi/görevi, renkli durum rozeti. Hassas alanlar listede yoktur. */
export default async function PersonnelPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ q?: string; durum?: string }>;
}) {
  const { siteId: rawId } = await params;
  const { q: rawQ, durum } = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const q = rawQ?.trim().slice(0, 100) || undefined;
  const status = PERSON_STATUSES.find((s) => s === durum) as PersonStatus | undefined;

  const [, all, role] = await Promise.all([requireUser(), listPersonnel(siteId, { q }), getSiteRole(siteId)]);

  // Güncel durum, kayıtlı çalışma durumundan ve izin/rapor/geçici görev tarihlerinden bugüne göre türetilir.
  const today = todayInIstanbul();
  const enriched = all.map((p) => ({ p, eff: effectiveStatus(p, today) }));
  const counts = new Map<PersonStatus, number>();
  for (const { eff } of enriched) counts.set(eff.status, (counts.get(eff.status) ?? 0) + 1);
  const people = status ? enriched.filter(({ eff }) => eff.status === status) : enriched;
  const canWrite = canWriteRole(role);
  const base = `/sites/${siteId}/personel`;
  const filtered = !!q || !!status;

  const chipHref = (s?: PersonStatus) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (s) sp.set("durum", s);
    const qs = sp.toString();
    return qs ? `${base}?${qs}` : base;
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Personel</h1>
        {canWrite && (
          <Link
            href={`${base}/yeni`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" aria-hidden />
            Yeni Personel
          </Link>
        )}
      </div>

      <form method="get" action={base} role="search" className="relative">
        {status && <input type="hidden" name="durum" value={status} />}
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Ad soyad ara"
          aria-label="Personel ara"
          autoComplete="off"
          className="h-11 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </form>

      <nav aria-label="Duruma göre filtre" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {[undefined, ...PERSON_STATUSES].map((s) => (
          <Link
            key={s ?? "hepsi"}
            href={chipHref(s)}
            aria-current={status === s ? "true" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium",
              status === s ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {s ? PERSON_STATUS_LABELS[s] : "Tümü"}
            <span className={cn("ml-1.5 text-xs", status === s ? "opacity-80" : "text-muted-foreground")}>
              {s ? (counts.get(s) ?? 0) : enriched.length}
            </span>
          </Link>
        ))}
      </nav>

      {people.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-14 text-center">
          <Users className="size-10 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">{filtered ? "Sonuç bulunamadı" : "Henüz personel eklenmedi"}</h2>
          <p className="text-sm text-muted-foreground">
            {filtered
              ? "Arama veya filtreyi değiştirip tekrar deneyin."
              : canWrite
                ? "Şantiyede çalışan personeli ekleyin; puantaj ve ödemeler bu listeye bağlanacak."
                : "Bu şantiyede henüz personel yok."}
          </p>
          {canWrite && !filtered && (
            <Link
              href={`${base}/yeni`}
              className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              <Plus className="size-4" aria-hidden />
              İlk personeli ekle
            </Link>
          )}
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {people.map(({ p, eff }) => (
            <DataRow
              key={p.id}
              href={`${base}/${p.id}`}
              title={p.full_name}
              badge={<StatusBadge status={eff.status} />}
              lines={[
                [p.job, p.duty].filter(Boolean).join(" · "),
                [p.parties?.name, p.phone].filter(Boolean).join(" · "),
                shortNote(eff),
              ]}
            />
          ))}
        </div>
      )}

      {all.length >= PERSON_LIST_LIMIT && (
        <p className="text-center text-xs text-muted-foreground">İlk {PERSON_LIST_LIMIT} kayıt gösteriliyor; aramayı daraltın.</p>
      )}
    </div>
  );
}
