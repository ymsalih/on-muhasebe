import "server-only";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, PARTY_CATEGORY_LABELS, type DocumentType, type PartyCategory } from "@/lib/goods/schemas";
import { INVOICE_TYPE_LABELS, type InvoiceType } from "@/lib/billing/schemas";
import { FUEL_TYPE_LABELS, type FuelType } from "@/lib/fuel/schemas";
import { PERSON_STATUS_LABELS, type PersonStatus } from "@/lib/personnel/schemas";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/parties/schemas";
import { listPartyBalances } from "@/lib/parties/queries";
import { loadReport } from "@/lib/reports/queries";
import { toTable, type ReportTable } from "@/lib/reports/table";

/**
 * "Tüm veri" Excel çalışma kitabı: seçili dönemde şantiyenin bütün kayıtları, sayfa sayfa (analiz için).
 * Veri çağıranın oturumuyla (RLS) okunur: ortak yalnızca kendi özel kayıtlarını (malzeme, yakıt, makine, hakediş, fatura),
 * admin hepsini içerir. Hassas alanlar (TC no, IBAN) hiçbir sayfada yoktur.
 */
const PAGE = 1000;
const MAX_ROWS = 50_000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** PostgREST'in 1000 satır sınırını aşmak için sayfa sayfa okur (en çok 50.000 satır). */
async function fetchAll<T>(build: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    if (error) throw new Error("rapor verisi okunamadı");
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const num = (v: unknown) => (v === null || v === undefined ? "" : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const date = (v: string | null) => (v ? formatDate(v) : "");

type Named = { name: string } | null;
type UserRef = { full_name: string } | null;

export async function loadFullData(siteId: number, siteName: string, from: string, to: string): Promise<ReportTable[]> {
  const supabase = await createClient();
  const subtitle = `${formatDate(from)} – ${formatDate(to)}`;
  const mk = (sheet: string, headers: string[], rows: (string | number)[][], opts: { money?: number[]; ints?: number[]; totals?: (string | number)[] } = {}): ReportTable => ({
    title: `${siteName} — ${sheet}`,
    subtitle,
    sheet,
    headers,
    moneyCols: opts.money ?? [],
    intCols: opts.ints ?? [],
    rows,
    totals: opts.totals,
  });
  const sum = (rows: (string | number)[][], col: number) => rows.reduce((s, r) => s + (typeof r[col] === "number" ? (r[col] as number) : 0), 0);

  const [overview, transactions, balances, personnel, attendance, goods, materials, fuel, machineDays, progress, invoices] = await Promise.all([
    loadReport(siteId, "ozet", from, to),
    fetchAll<{ transaction_date: string; type: string; description: string; amount: number | string; payment_method: PaymentMethod | null; categories: Named; parties: Named; users: UserRef }>((a, b) =>
      supabase
        .from("transactions")
        .select("transaction_date, type, description, amount, payment_method, categories(name), parties(name), users(full_name)")
        .eq("site_id", siteId).gte("transaction_date", from).lte("transaction_date", to)
        .order("transaction_date").order("id").range(a, b) as unknown as PageResult<never>,
    ),
    listPartyBalances(siteId),
    fetchAll<{ full_name: string; job: string | null; duty: string | null; status: PersonStatus; hire_date: string | null; termination_date: string | null; daily_wage: number | string | null }>((a, b) =>
      supabase.from("personnel").select("full_name, job, duty, status, hire_date, termination_date, daily_wage").eq("site_id", siteId).order("full_name").range(a, b) as unknown as PageResult<never>,
    ),
    fetchAll<{ work_date: string; note: string | null; personnel: { full_name: string } | null }>((a, b) =>
      supabase.from("attendance").select("work_date, note, personnel(full_name)").eq("site_id", siteId).gte("work_date", from).lte("work_date", to).order("work_date").order("id").range(a, b) as unknown as PageResult<never>,
    ),
    fetchAll<{ entry_date: string; document_type: DocumentType; document_no: string | null; material_type: string | null; unit: string | null; quantity: number | string | null; unit_price: number | string | null; total_amount: number | string | null; used_location: string | null; purchase_location: string | null; transport_cost: number | string | null; parties: Named }>((a, b) =>
      supabase.from("goods_entries").select("entry_date, document_type, document_no, material_type, unit, quantity, unit_price, total_amount, used_location, purchase_location, transport_cost, parties(name)")
        .eq("site_id", siteId).gte("entry_date", from).lte("entry_date", to).order("entry_date").order("id").range(a, b) as unknown as PageResult<never>,
    ),
    fetchAll<{ entry_date: string; name: string; unit: string; quantity: number | string; unit_price: number | string; total_amount: number | string; supplier: string | null; used_for: string | null; note: string | null; users: UserRef }>((a, b) =>
      supabase.from("material_entries").select("entry_date, name, unit, quantity, unit_price, total_amount, supplier, used_for, note, users(full_name)")
        .eq("site_id", siteId).gte("entry_date", from).lte("entry_date", to).order("entry_date").order("id").range(a, b) as unknown as PageResult<never>,
    ),
    fetchAll<{ fuel_date: string; fuel_type: FuelType; liters: number | string; unit_price: number | string; total_amount: number | string; fueled_by: string | null; station: string | null; note: string | null; machines: { name: string; identifier: string | null } | null; users: UserRef }>((a, b) =>
      supabase.from("fuel_entries").select("fuel_date, fuel_type, liters, unit_price, total_amount, fueled_by, station, note, machines(name, identifier), users(full_name)")
        .eq("site_id", siteId).gte("fuel_date", from).lte("fuel_date", to).order("fuel_date").order("id").range(a, b) as unknown as PageResult<never>,
    ),
    fetchAll<{ work_date: string; hours: number | string | null; note: string | null; machines: { name: string; identifier: string | null } | null; users: UserRef }>((a, b) =>
      supabase.from("machine_attendance").select("work_date, hours, note, machines(name, identifier), users(full_name)")
        .eq("site_id", siteId).gte("work_date", from).lte("work_date", to).order("work_date").order("id").range(a, b) as unknown as PageResult<never>,
    ),
    fetchAll<{ payment_date: string; description: string | null; amount: number | string; users: UserRef }>((a, b) =>
      supabase.from("progress_payments").select("payment_date, description, amount, users(full_name)")
        .eq("site_id", siteId).gte("payment_date", from).lte("payment_date", to).order("payment_date").order("id").range(a, b) as unknown as PageResult<never>,
    ),
    fetchAll<{ invoice_date: string; invoice_no: string | null; invoice_type: InvoiceType; description: string; amount: number | string; kdv_rate: number | string; kdv_amount: number | string; total_with_kdv: number | string; users: UserRef }>((a, b) =>
      supabase.from("invoices").select("invoice_date, invoice_no, invoice_type, description, amount, kdv_rate, kdv_amount, total_with_kdv, users(full_name)")
        .eq("site_id", siteId).gte("invoice_date", from).lte("invoice_date", to).order("invoice_date").order("id").range(a, b) as unknown as PageResult<never>,
    ),
  ]);

  const sheets: ReportTable[] = [];

  const ozet = toTable(overview, siteName, from, to);
  sheets.push({ ...ozet, sheet: "Özet" });

  const kasaRows = transactions.map((r) => [date(r.transaction_date), r.type === "income" ? "Gelir" : "Gider", txt(r.categories?.name), txt(r.parties?.name), r.description, Number(r.amount), r.payment_method ? PAYMENT_METHOD_LABELS[r.payment_method] : "", txt(r.users?.full_name)]);
  sheets.push(mk("Kasa", ["Tarih", "Tür", "Kategori", "Cari", "Açıklama", "Tutar", "Ödeme yöntemi", "Giren"], kasaRows, {
    money: [5],
    totals: ["", "", "", "", "Gelir − gider", transactions.reduce((s, r) => s + (r.type === "income" ? Number(r.amount) : -Number(r.amount)), 0), "", ""],
  }));

  sheets.push({
    title: `${siteName} — Cari bakiyeleri (tüm zamanlar)`,
    subtitle: "Tüm zamanların bakiyeleri (dönemden bağımsız)",
    sheet: "Cariler",
    headers: ["Cari", "Kategori", "Faturalanan", "Ödenen", "Tahsil edilen", "Kalan borç", "Hareket sayısı", "Son hareket"],
    moneyCols: [2, 3, 4, 5],
    intCols: [6],
    rows: balances.map((b) => [b.name, PARTY_CATEGORY_LABELS[b.category as PartyCategory], b.total_invoiced, b.total_expense, b.total_income, b.total_invoiced - b.total_expense, b.transaction_count, date(b.last_transaction_date)]),
  });

  sheets.push({
    title: `${siteName} — Personel`,
    subtitle: "Kayıtlı personel (TC no ve IBAN bilerek yer almaz)",
    sheet: "Personel",
    headers: ["Ad soyad", "İşi", "Görevi", "Durum", "İşe giriş", "İşten çıkış", "Günlük ücret"],
    moneyCols: [6],
    intCols: [],
    rows: personnel.map((p) => [p.full_name, txt(p.job), txt(p.duty), PERSON_STATUS_LABELS[p.status] ?? p.status, date(p.hire_date), date(p.termination_date), num(p.daily_wage)]),
  });

  sheets.push(mk("Puantaj", ["Tarih", "Personel", "Not"], attendance.map((r) => [date(r.work_date), txt(r.personnel?.full_name), txt(r.note)])));

  const goodsRows = goods.map((r) => [date(r.entry_date), DOCUMENT_TYPE_LABELS[r.document_type], txt(r.document_no), txt(r.parties?.name), txt(r.material_type), num(r.quantity), txt(r.unit), num(r.unit_price), num(r.total_amount), num(r.transport_cost), txt(r.used_location), txt(r.purchase_location)]);
  sheets.push(mk("İrsaliye-Fatura", ["Tarih", "Tür", "No", "Firma", "Malzeme", "Miktar", "Birim", "Birim fiyat", "Tutar", "Nakliye", "Kullanıldığı yer", "Satın alma yeri"], goodsRows, {
    money: [7, 8, 9],
    totals: ["Toplam", "", "", "", "", "", "", "", sum(goodsRows, 8), sum(goodsRows, 9), "", ""],
  }));

  const matRows = materials.map((r) => [date(r.entry_date), txt(r.users?.full_name), r.name, Number(r.quantity), r.unit, Number(r.unit_price), Number(r.total_amount), txt(r.supplier), txt(r.used_for), txt(r.note)]);
  sheets.push(mk("Malzeme", ["Tarih", "Ortak", "Malzeme", "Miktar", "Birim", "Birim fiyat", "Maliyet", "Kimden", "Kullanım yeri", "Not"], matRows, {
    money: [5, 6],
    totals: ["Toplam", "", "", "", "", "", sum(matRows, 6), "", "", ""],
  }));

  const fuelRows = fuel.map((r) => [date(r.fuel_date), txt(r.users?.full_name), txt(r.machines?.name), txt(r.machines?.identifier), FUEL_TYPE_LABELS[r.fuel_type], Number(r.liters), Number(r.unit_price), Number(r.total_amount), txt(r.fueled_by), txt(r.station), txt(r.note)]);
  sheets.push(mk("Yakıt", ["Tarih", "Ortak", "Araç", "Plaka / No", "Yakıt türü", "Litre", "Litre fiyatı", "Tutar", "Alan kişi", "İstasyon", "Not"], fuelRows, {
    money: [6, 7],
    ints: [5],
    totals: ["Toplam", "", "", "", "", sum(fuelRows, 5), "", sum(fuelRows, 7), "", "", ""],
  }));

  sheets.push(mk("Makine Puantajı", ["Tarih", "Ortak", "Makine", "Plaka / No", "Saat", "Not"], machineDays.map((r) => [date(r.work_date), txt(r.users?.full_name), txt(r.machines?.name), txt(r.machines?.identifier), num(r.hours), txt(r.note)]), { ints: [4] }));

  const progRows = progress.map((r) => [date(r.payment_date), txt(r.users?.full_name), txt(r.description), Number(r.amount)]);
  sheets.push(mk("Hakediş", ["Tarih", "Ortak", "Açıklama", "Tutar"], progRows, { money: [3], totals: ["Toplam", "", "", sum(progRows, 3)] }));

  const invRows = invoices.map((r) => [date(r.invoice_date), txt(r.users?.full_name), txt(r.invoice_no), INVOICE_TYPE_LABELS[r.invoice_type], r.description, Number(r.amount), Number(r.kdv_rate), Number(r.kdv_amount), Number(r.total_with_kdv)]);
  sheets.push(mk("Fatura", ["Tarih", "Ortak", "Fatura no", "Tür", "Açıklama", "Tutar (KDV hariç)", "KDV oranı (%)", "KDV", "Toplam (KDV dahil)"], invRows, {
    money: [5, 7, 8],
    totals: ["Toplam", "", "", "", "", sum(invRows, 5), "", sum(invRows, 7), sum(invRows, 8)],
  }));

  return sheets;
}
