import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { InvoiceType } from "@/lib/billing/schemas";

export const BILLING_LIST_LIMIT = 500;

export type PaymentRow = { id: number; date: string; description: string | null; amount: number };
export type InvoiceRow = { id: number; date: string; invoiceNo: string | null; type: InvoiceType; description: string; amount: number };

/** Bir ortağın bu şantiyedeki hakedişleri, en yeniden eskiye. RLS: ortak yalnızca kendininkini, admin hepsini okur. */
export async function listProgressPayments(siteId: number, ownerId: string): Promise<{ rows: PaymentRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("progress_payments")
    .select("id, payment_date, description, amount")
    .eq("site_id", siteId)
    .eq("created_by", ownerId)
    .order("payment_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(BILLING_LIST_LIMIT + 1);
  if (error) throw new Error("progress_payments okunamadı");
  const all = ((data ?? []) as { id: number; payment_date: string; description: string | null; amount: number | string }[]).map((r) => ({
    id: r.id,
    date: r.payment_date,
    description: r.description,
    amount: Number(r.amount),
  }));
  return { rows: all.slice(0, BILLING_LIST_LIMIT), hasMore: all.length > BILLING_LIST_LIMIT };
}

export async function listInvoices(siteId: number, ownerId: string): Promise<{ rows: InvoiceRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_date, invoice_no, invoice_type, description, amount")
    .eq("site_id", siteId)
    .eq("created_by", ownerId)
    .order("invoice_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(BILLING_LIST_LIMIT + 1);
  if (error) throw new Error("invoices okunamadı");
  const all = ((data ?? []) as { id: number; invoice_date: string; invoice_no: string | null; invoice_type: InvoiceType; description: string; amount: number | string }[]).map((r) => ({
    id: r.id,
    date: r.invoice_date,
    invoiceNo: r.invoice_no,
    type: r.invoice_type,
    description: r.description,
    amount: Number(r.amount),
  }));
  return { rows: all.slice(0, BILLING_LIST_LIMIT), hasMore: all.length > BILLING_LIST_LIMIT };
}

export type BillingSummary = {
  progressTotal: number;
  progressCount: number;
  invoiceTotal: number;
  invoiceCount: number;
  byType: { type: InvoiceType; total: number; count: number }[];
};

/** Toplam hakediş, toplam fatura ve fatura türü kırılımı — get_billing_summary RPC'siyle TEK çağrıda (tüm kayıtlar, liste sınırından bağımsız). */
export async function getBillingSummary(siteId: number, ownerId: string): Promise<BillingSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_billing_summary", { p_site_id: siteId, p_owner: ownerId });
  if (error) throw new Error("get_billing_summary okunamadı");
  const rows = (data ?? []) as { kind: string; invoice_type: InvoiceType | null; entry_count: number; total: number | string }[];
  const progress = rows.find((r) => r.kind === "hakedis");
  const invoices = rows.filter((r) => r.kind === "fatura" && r.invoice_type);
  const byType = invoices.map((r) => ({ type: r.invoice_type as InvoiceType, total: Number(r.total), count: r.entry_count })).sort((a, b) => b.total - a.total);
  return {
    progressTotal: Number(progress?.total ?? 0),
    progressCount: progress?.entry_count ?? 0,
    invoiceTotal: byType.reduce((s, r) => s + r.total, 0),
    invoiceCount: byType.reduce((s, r) => s + r.count, 0),
    byType,
  };
}

export type BillingOwner = { id: string; name: string };

/** Şantiyede hakediş/faturası olan ortaklar (admin seçicisi için; ortak yalnızca kendini görür). */
export async function getBillingOwners(siteId: number): Promise<BillingOwner[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_billing_owners", { p_site_id: siteId });
  if (error) throw new Error("get_billing_owners okunamadı");
  return ((data ?? []) as { owner_id: string; full_name: string }[]).map((r) => ({ id: r.owner_id, name: r.full_name }));
}
