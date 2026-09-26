import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookUser, Plus, Search } from "lucide-react";
import { DataRow } from "@/components/data-row";
import { BalanceAmount, CategoryBadge } from "@/components/parties/balance";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { PARTY_CATEGORIES, PARTY_CATEGORY_LABELS, type PartyCategory } from "@/lib/goods/schemas";
import { listPartyBalances } from "@/lib/parties/queries";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cari Hesaplar — Şantiye Ön Muhasebe" };

/** Cari listesi (CLAUDE.md 7.3-F): ad arama, kategori çipleri, güncel bakiye (party_balances). */
export default async function PartiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ q?: string; kategori?: string }>;
}) {
  const { siteId: rawId } = await params;
  const { q: rawQ, kategori } = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const q = rawQ?.trim().slice(0, 100) || undefined;
  const category = PARTY_CATEGORIES.find((c) => c === kategori) as PartyCategory | undefined;

  const [, all, role] = await Promise.all([requireUser(), listPartyBalances(siteId), getSiteRole(siteId)]);
  const canWrite = canWriteRole(role);
  const base = `/sites/${siteId}/cari`;

  // Arama ve kategori sayıları tek sorgudan gelen listeyle yapılır (şantiye başına yüzlerce cari).
  const needle = q?.toLocaleLowerCase("tr-TR");
  const searched = needle ? all.filter((p) => p.name.toLocaleLowerCase("tr-TR").includes(needle)) : all;
  const counts = new Map<PartyCategory, number>();
  for (const p of searched) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const parties = category ? searched.filter((p) => p.category === category) : searched;
  const filtered = !!q || !!category;

  const chipHref = (c?: PartyCategory) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (c) sp.set("kategori", c);
    const qs = sp.toString();
    return qs ? `${base}?${qs}` : base;
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Cari Hesaplar</h1>
        {canWrite && (
          <Link
            href={`${base}/yeni`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" aria-hidden />
            Yeni Cari
          </Link>
        )}
      </div>

      <form method="get" action={base} role="search" className="relative">
        {category && <input type="hidden" name="kategori" value={category} />}
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Cari ara"
          aria-label="Cari ara"
          autoComplete="off"
          className="h-11 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </form>

      <nav aria-label="Kategoriye göre filtre" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {[undefined, ...PARTY_CATEGORIES].map((c) => (
          <Link
            key={c ?? "hepsi"}
            href={chipHref(c)}
            aria-current={category === c ? "true" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium",
              category === c ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {c ? PARTY_CATEGORY_LABELS[c] : "Tümü"}
            <span className={cn("ml-1.5 text-xs", category === c ? "opacity-80" : "text-muted-foreground")}>
              {c ? (counts.get(c) ?? 0) : searched.length}
            </span>
          </Link>
        ))}
      </nav>

      {parties.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-14 text-center">
          <BookUser className="size-10 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">{filtered ? "Sonuç bulunamadı" : "Henüz cari eklenmedi"}</h2>
          <p className="text-sm text-muted-foreground">
            {filtered
              ? "Arama veya filtreyi değiştirip tekrar deneyin."
              : canWrite
                ? "Firma, nakliyeci, araç veya müşteri ekleyin; ödeme ve tahsilatlarını takip edin."
                : "Bu şantiyede henüz cari yok."}
          </p>
          {canWrite && !filtered && (
            <Link
              href={`${base}/yeni`}
              className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              <Plus className="size-4" aria-hidden />
              İlk cariyi ekle
            </Link>
          )}
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {parties.map((p) => (
            <DataRow
              key={p.party_id}
              href={`${base}/${p.party_id}`}
              title={p.name}
              badge={<CategoryBadge category={p.category} />}
              lines={[
                p.transaction_count > 0
                  ? `${p.transaction_count} hareket · son: ${formatDate(p.last_transaction_date)}`
                  : "Henüz hareket yok",
              ]}
              trailing={<BalanceAmount balance={p.balance} />}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">Bakiye = Tahsilat − Ödeme. Yeşil: tahsilat fazla · Kırmızı: ödeme fazla.</p>
    </div>
  );
}
