import { NextResponse, type NextRequest } from "next/server";
import { getAuthUserId } from "@/lib/auth/session";
import { resolveRange } from "@/lib/cash/range";
import { breakdownTable, entriesTable } from "@/lib/materials/export-table";
import { getCostBreakdown, listMaterialEntries } from "@/lib/materials/queries";
import type { Breakdown } from "@/lib/materials/schemas";
import { todayInIstanbul } from "@/lib/personnel/status";
import { toPdf, toXlsx } from "@/lib/reports/export-files";
import { getAccessibleSites } from "@/lib/sites/queries";

export const dynamic = "force-dynamic";

const VIEW_TO_BREAKDOWN: Record<string, Breakdown> = { ortak: "partner", malzeme: "item", kullanim: "usage" };

/** Malzeme dışa aktarma (Excel/PDF): girişler veya maliyet kırılımı (ortak / malzeme / kullanım yeri). Veri çağıranın oturumuyla (RLS) okunur. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) return new NextResponse("Geçersiz istek", { status: 400 });
  if (!(await getAuthUserId())) return new NextResponse("Oturum gerekli", { status: 401 });

  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const view = sp.get("gorunum") ?? "giris";
  const by = VIEW_TO_BREAKDOWN[view];
  const range = resolveRange(sp.get("aralik") ?? undefined, todayInIstanbul(), sp.get("baslangic") ?? undefined, sp.get("bitis") ?? undefined);

  const site = (await getAccessibleSites()).find((s) => s.id === siteId);
  if (!site) return new NextResponse("Şantiye bulunamadı", { status: 404 });

  const table = by
    ? breakdownTable(site.name, range.from, range.to, by, await getCostBreakdown(siteId, range.from, range.to, by))
    : entriesTable(site.name, range.from, range.to, (await listMaterialEntries(siteId, range.from, range.to, 5000)).rows);
  const filename = `malzeme-${by ? view : "giris"}-${range.from}_${range.to}.${format}`;

  const body = format === "pdf" ? await toPdf(table) : await toXlsx(table, table.title);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
