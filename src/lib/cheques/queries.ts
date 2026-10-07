import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/personnel/status";
import { ALERT_DAYS, type ChequeDirection, type ChequeStatus } from "@/lib/cheques/schemas";

export type ChequeRow = {
  id: number;
  direction: ChequeDirection;
  counterparty: string;
  amount: number;
  dueDate: string;
  issueDate: string | null;
  chequeNo: string | null;
  bank: string | null;
  note: string | null;
  status: ChequeStatus;
  settledDate: string | null;
};

export const CHEQUE_LIST_LIMIT = 300;

/** Liste görünümleri: bekleyenler, 7 gün içinde yaklaşanlar, vadesi geçmişler, tamamlananlar, diğer (karşılıksız/iptal), hepsi. */
export const CHEQUE_VIEWS = ["bekleyen", "yaklasan", "gecmis", "tamam", "diger", "hepsi"] as const;
export type ChequeView = (typeof CHEQUE_VIEWS)[number];
export const CHEQUE_VIEW_LABELS: Record<ChequeView, string> = {
  bekleyen: "Bekleyenler",
  yaklasan: "Yaklaşanlar",
  gecmis: "Vadesi Geçmiş",
  tamam: "Tahsil / Ödenen",
  diger: "Karşılıksız / İptal",
  hepsi: "Tümü",
};

const COLUMNS = "id, direction, counterparty, amount, due_date, issue_date, cheque_no, bank, note, status, settled_date";

type DbRow = {
  id: number;
  direction: ChequeDirection;
  counterparty: string;
  amount: number | string;
  due_date: string;
  issue_date: string | null;
  cheque_no: string | null;
  bank: string | null;
  note: string | null;
  status: ChequeStatus;
  settled_date: string | null;
};

/** Bir ortağın bu şantiyedeki çekleri. Bekleyenler en yakın vadeden başlar; tamamlananlar en yeniden eskiye. RLS: ortak yalnızca kendininkini, admin hepsini okur. */
export async function listCheques(
  siteId: number,
  ownerId: string,
  view: ChequeView,
  direction: ChequeDirection | null,
  today: string,
  limit = CHEQUE_LIST_LIMIT,
): Promise<{ rows: ChequeRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  let q = supabase.from("cheques").select(COLUMNS).eq("site_id", siteId).eq("owner_id", ownerId);
  if (direction) q = q.eq("direction", direction);
  switch (view) {
    case "bekleyen":
      q = q.eq("status", "pending");
      break;
    case "yaklasan":
      q = q.eq("status", "pending").gte("due_date", today).lte("due_date", addDays(today, ALERT_DAYS));
      break;
    case "gecmis":
      q = q.eq("status", "pending").lt("due_date", today);
      break;
    case "tamam":
      q = q.eq("status", "settled");
      break;
    case "diger":
      q = q.in("status", ["bounced", "cancelled"]);
      break;
  }
  const pendingView = view === "bekleyen" || view === "yaklasan" || view === "gecmis";
  const { data, error } = await q
    .order("due_date", { ascending: pendingView })
    .order("id", { ascending: pendingView })
    .limit(limit + 1);
  if (error) throw new Error("cheques okunamadı");
  const all = ((data ?? []) as unknown as DbRow[]).map((r) => ({
    id: r.id,
    direction: r.direction,
    counterparty: r.counterparty,
    amount: Number(r.amount),
    dueDate: r.due_date,
    issueDate: r.issue_date,
    chequeNo: r.cheque_no,
    bank: r.bank,
    note: r.note,
    status: r.status,
    settledDate: r.settled_date,
  }));
  return { rows: all.slice(0, limit), hasMore: all.length > limit };
}

export type ChequeSummary = {
  receivedCount: number;
  receivedTotal: number;
  givenCount: number;
  givenTotal: number;
  soonCount: number;
  soonReceived: number;
  soonGiven: number;
  overdueCount: number;
  overdueReceived: number;
  overdueGiven: number;
};

/** Bir ortağın bekleyen çeklerinin özeti (get_cheque_summary RPC'si, TEK çağrı; liste sınırından bağımsız). */
export async function getChequeSummary(siteId: number, ownerId: string): Promise<ChequeSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_cheque_summary", { p_site_id: siteId, p_owner: ownerId, p_days: ALERT_DAYS });
  if (error || !data) throw new Error("get_cheque_summary okunamadı");
  const d = data as Record<string, number | string>;
  const n = (k: string) => Number(d[k] ?? 0);
  return {
    receivedCount: n("received_count"),
    receivedTotal: n("received_total"),
    givenCount: n("given_count"),
    givenTotal: n("given_total"),
    soonCount: n("soon_count"),
    soonReceived: n("soon_received"),
    soonGiven: n("soon_given"),
    overdueCount: n("overdue_count"),
    overdueReceived: n("overdue_received"),
    overdueGiven: n("overdue_given"),
  };
}

export type ChequeAlert = {
  id: number;
  siteId: number;
  siteName: string;
  direction: ChequeDirection;
  counterparty: string;
  amount: number;
  dueDate: string;
  /** Vadeye kalan gün; negatif = vadesi geçmiş */
  daysLeft: number;
};

/**
 * Çağıranın KENDİ bekleyen çekleri içinde vadesi yaklaşan (≤ 7 gün) veya geçmiş olanlar. siteId null = tüm şantiyeler.
 * Aynı istekte (şantiye düzeni + sayfa) tek sorgu olur (cache). Uyarı sayfaları bozmasın diye hata durumunda boş döner.
 */
export const getChequeAlerts = cache(async (siteId: number | null): Promise<ChequeAlert[]> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_cheque_alerts", { p_site_id: siteId, p_days: ALERT_DAYS });
    if (error) throw error;
    return ((data ?? []) as { id: number; site_id: number; site_name: string; direction: ChequeDirection; counterparty: string; amount: number | string; due_date: string; days_left: number }[]).map((r) => ({
      id: r.id,
      siteId: r.site_id,
      siteName: r.site_name,
      direction: r.direction,
      counterparty: r.counterparty,
      amount: Number(r.amount),
      dueDate: r.due_date,
      daysLeft: r.days_left,
    }));
  } catch (e) {
    console.error("çek uyarıları okunamadı", e);
    return [];
  }
});

export type ChequeOwner = { id: string; name: string };

/** Şantiyede çeki olan ortaklar (admin seçicisi için; ortak yalnızca kendini görür). */
export async function getChequeOwners(siteId: number): Promise<ChequeOwner[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_cheque_owners", { p_site_id: siteId });
  if (error) throw new Error("get_cheque_owners okunamadı");
  return ((data ?? []) as { owner_id: string; full_name: string }[]).map((r) => ({ id: r.owner_id, name: r.full_name }));
}

/** Formdaki otomatik tamamlama önerileri: bu ortağın bu şantiyedeki geçmiş çeklerinden karşı taraf ve bankalar. */
export async function getChequeSuggestions(siteId: number, ownerId: string): Promise<{ parties: string[]; banks: string[] }> {
  const supabase = await createClient();
  const { data } = await supabase.from("cheques").select("counterparty, bank").eq("site_id", siteId).eq("owner_id", ownerId).order("id", { ascending: false }).limit(300);
  const uniq = (key: "counterparty" | "bank") => [...new Set((data ?? []).map((r) => r[key]).filter((v): v is string => !!v))].slice(0, 50);
  return { parties: uniq("counterparty"), banks: uniq("bank") };
}
