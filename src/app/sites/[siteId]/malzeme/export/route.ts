import { NextResponse, type NextRequest } from "next/server";
import { getAuthUserId } from "@/lib/auth/session";
import { resolveRange } from "@/lib/cash/range";
import { outflowTable, stockTable } from "@/lib/materials/export-table";
import { getMaterialSummary, listMovements } from "@/lib/materials/queries";
import { todayInIstanbul } from "@/lib/personnel/status";
import { toPdf, toXlsx } from "@/lib/reports/export-files";
import { getAccessibleSites } from "@/lib/sites/queries";

export const dynamic = "force-dynamic";

/** Malzeme dışa aktarma (Excel/PDF): `gorunum=cikis` çıkış raporu, aksi halde stok durumu. Veri çağıranın oturumuyla (RLS) okunur. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) return new NextResponse("Geçersiz istek", { status: 400 });
  if (!(await getAuthUserId())) return new NextResponse("Oturum gerekli", { status: 401 });

  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const kind = sp.get("gorunum") === "cikis" ? "cikis" : "stok";
  const range = resolveRange(sp.get("aralik") ?? undefined, todayInIstanbul(), sp.get("baslangic") ?? undefined, sp.get("bitis") ?? undefined);

  const site = (await getAccessibleSites()).find((s) => s.id === siteId);
  if (!site) return new NextResponse("Şantiye bulunamadı", { status: 404 });

  const [summary, outs] = await Promise.all([
    getMaterialSummary(siteId, range.from, range.to),
    kind === "cikis" ? listMovements(siteId, { from: range.from, to: range.to, type: "out" }, 5000) : Promise.resolve(null),
  ]);
  const table = kind === "cikis" ? outflowTable(site.name, range.from, range.to, outs!.rows, summary.rows) : stockTable(site.name, range.from, range.to, summary.rows);
  const filename = `malzeme-${kind}-${range.from}_${range.to}.${format}`;

  const body = format === "pdf" ? await toPdf(table) : await toXlsx(table, table.title);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
