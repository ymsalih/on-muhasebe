import { NextResponse, type NextRequest } from "next/server";
import { getAuthUserId } from "@/lib/auth/session";
import { resolveRange } from "@/lib/cash/range";
import { todayInIstanbul } from "@/lib/personnel/status";
import { loadReport, resolveTab } from "@/lib/reports/queries";
import { toPdf, toXlsx, toXlsxWorkbook } from "@/lib/reports/export-files";
import { loadFullData } from "@/lib/reports/full-data";
import { toTable } from "@/lib/reports/table";
import { getAccessibleSites } from "@/lib/sites/queries";

export const dynamic = "force-dynamic";

/**
 * Rapor dışa aktarma (Excel / PDF). Sayfadaki sekme ve dönem parametreleriyle aynıdır; veri, çağıranın oturumuyla
 * (RLS) okunur — üyesi olmadığı şantiyenin raporunu kimse indiremez.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) return new NextResponse("Geçersiz istek", { status: 400 });
  if (!(await getAuthUserId())) return new NextResponse("Oturum gerekli", { status: 401 });

  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const tab = resolveTab(sp.get("sekme") ?? undefined);
  const range = resolveRange(sp.get("aralik") ?? undefined, todayInIstanbul(), sp.get("baslangic") ?? undefined, sp.get("bitis") ?? undefined);

  const site = (await getAccessibleSites()).find((s) => s.id === siteId);
  if (!site) return new NextResponse("Şantiye bulunamadı", { status: 404 });

  const data = await loadReport(siteId, tab, range.from, range.to);
  const table = toTable(data, site.name, range.from, range.to);
  const filename = `rapor-${tab}-${range.from}_${range.to}.${format}`;

  // Genel Özet'te Excel, şantiyenin dönemdeki TÜM kayıtlarını sayfa sayfa içerir (analiz için); PDF özet tablodur.
  const body = format === "pdf" ? await toPdf(table) : tab === "ozet" ? await toXlsxWorkbook(await loadFullData(siteId, site.name, range.from, range.to)) : await toXlsx(table, table.title);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
