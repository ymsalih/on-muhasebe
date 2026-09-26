/** RLS/tutarlılık testi (Faz 8a): irsaliye birim fiyatı + otomatik tutar, personel günlük ücreti,
 *  gün × günlük tutar maaş ödemesi (transactions.work_days/daily_rate/period_month), party_balances.total_invoiced.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:prices  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const tag = randomBytes(4).toString("hex");
const pw = () => randomBytes(12).toString("base64url") + "aA1";
const accounts = {
  admin: { role: "admin" },
  owner: { role: "partner" },
  partner: { role: "partner" },
  viewer: { role: "partner" },
  outsider: { role: "partner" },
} as const;
type Who = keyof typeof accounts;
const cred = {} as Record<Who, { email: string; password: string }>;
const ids = {} as Record<Who, string>;
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);
const denied = (r: { error: unknown; data?: unknown }) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);

async function login(who: Who): Promise<SupabaseClient> {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword(cred[who]);
  if (error) throw error;
  return c;
}

const siteIds: number[] = [];
try {
  for (const w of Object.keys(accounts) as Who[]) {
    cred[w] = { email: `t-${w}-${tag}@example.test`, password: pw() };
    const { data, error } = await svc.auth.admin.createUser({ ...cred[w], email_confirm: true });
    if (error) throw error;
    ids[w] = data.user.id;
    const { error: e2 } = await svc.from("users").insert({ id: ids[w], full_name: `T ${w} ${tag}`, email: cred[w].email, role: accounts[w].role, must_change_password: false });
    if (e2) throw e2;
  }
  const { data: site } = await svc.from("sites").insert({ name: `Fiyat ${tag}`, created_by: ids.owner }).select("id").single();
  const siteA = site!.id as number;
  siteIds.push(siteA);
  await svc.from("site_members").insert([
    { site_id: siteA, user_id: ids.owner, role: "owner" },
    { site_id: siteA, user_id: ids.partner, role: "partner" },
    { site_id: siteA, user_id: ids.viewer, role: "viewer" },
  ]);
  const { data: party } = await svc.from("parties").insert({ site_id: siteA, name: `Firma ${tag}`, category: "firma" }).select("id").single();
  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  // ---------- irsaliye birim fiyatı ----------
  const ge = { site_id: siteA, entry_date: "2026-09-10", document_type: "irsaliye", party_id: party!.id, material_type: "Çimento", unit: "torba", created_by: ids.partner };
  const g1 = await c.partner.from("goods_entries").insert({ ...ge, quantity: 12.5, unit_price: 80.25 }).select("id, total_amount").single();
  check("ortak birim fiyatlı irsaliye ekleyebilir", !g1.error, g1.error?.message);
  check("tutar = miktar × birim fiyat (1003,13)", Number(g1.data?.total_amount) === 1003.13, String(g1.data?.total_amount));
  const g2 = await c.partner.from("goods_entries").insert({ ...ge, quantity: 10, unit_price: 100 }).select("id, total_amount").single();
  check("ikinci irsaliye tutarı 1000", Number(g2.data?.total_amount) === 1000);
  const g3 = await c.partner.from("goods_entries").insert({ ...ge, quantity: 5 }).select("id, total_amount").single();
  check("birim fiyat yoksa tutar boş", !g3.error && g3.data?.total_amount === null);
  check("negatif birim fiyat reddedilir", !!(await c.partner.from("goods_entries").insert({ ...ge, quantity: 1, unit_price: -1 })).error);
  check("tutar sütunu elle yazılamaz", !!(await c.partner.from("goods_entries").insert({ ...ge, quantity: 1, unit_price: 1, total_amount: 999 })).error);
  const up = await c.partner.from("goods_entries").update({ unit_price: 90 }).eq("id", g1.data!.id).select("total_amount");
  check("birim fiyat güncellenince tutar yeniden hesaplanır (1125)", Number(up.data?.[0]?.total_amount) === 1125, JSON.stringify(up));
  check("viewer birim fiyat güncelleyemez", denied(await c.viewer.from("goods_entries").update({ unit_price: 1 }).eq("id", g1.data!.id).select("id")));
  check("üye olmayan irsaliye tutarını okuyamaz", denied(await c.outsider.from("goods_entries").select("total_amount").eq("id", g1.data!.id)));

  // ---------- cari: faturalanan toplam ----------
  await svc.from("transactions").insert({ site_id: siteA, user_id: ids.partner, party_id: party!.id, type: "expense", description: "Kısmi ödeme", amount: 700, transaction_date: "2026-09-12" });
  const pb = await c.partner.from("party_balances").select("total_invoiced, total_expense").eq("party_id", party!.id).single();
  check("party_balances.total_invoiced = 1125 + 1000", Number(pb.data?.total_invoiced) === 2125, JSON.stringify(pb));
  check("kalan borç = faturalanan − ödenen (1425)", Number(pb.data?.total_invoiced) - Number(pb.data?.total_expense) === 1425);
  check("üye olmayan party_balances göremez", denied(await c.outsider.from("party_balances").select("total_invoiced").eq("party_id", party!.id)));

  // ---------- personel günlük ücreti ----------
  const pr = await c.partner.from("personnel").insert({ site_id: siteA, status: "aktif", full_name: `Kisi ${tag}`, daily_wage: 1500 }).select("id, daily_wage").single();
  check("ortak günlük ücretli personel ekleyebilir", !pr.error && Number(pr.data?.daily_wage) === 1500, pr.error?.message);
  const personId = pr.data!.id as number;
  check("negatif günlük ücret reddedilir", !!(await c.partner.from("personnel").insert({ site_id: siteA, status: "aktif", full_name: "Negatif", daily_wage: -1 })).error);
  check("ortak günlük ücreti güncelleyebilir", (await c.partner.from("personnel").update({ daily_wage: 1600 }).eq("id", personId).select("id")).data?.length === 1);
  check("viewer günlük ücreti güncelleyemez", denied(await c.viewer.from("personnel").update({ daily_wage: 1 }).eq("id", personId).select("id")));
  check("üye olmayan günlük ücreti okuyamaz", denied(await c.outsider.from("personnel").select("daily_wage").eq("id", personId)));
  check("viewer günlük ücreti okuyabilir (salt görüntüleme)", !(await c.viewer.from("personnel").select("daily_wage").eq("id", personId)).error);

  // ---------- maaş ödemesi: gün × günlük tutar ----------
  const wage = { site_id: siteA, user_id: ids.partner, personnel_id: personId, type: "expense", description: "Eylül maaşı", transaction_date: "2026-09-30", work_days: 22, daily_rate: 1500, amount: 33000, period_month: "2026-09-01" };
  const w1 = await c.partner.from("transactions").insert(wage).select("id").single();
  check("ortak maaş ödemesi ekleyebilir (22 × 1500 = 33000)", !w1.error, w1.error?.message);
  check("tutar gün × ücretle uyuşmazsa reddedilir", !!(await c.partner.from("transactions").insert({ ...wage, amount: 33001 })).error);
  check("yalnızca gün girilip ücret girilmezse reddedilir", !!(await c.partner.from("transactions").insert({ ...wage, daily_rate: null })).error);
  check("personel olmadan maaş dökümü reddedilir", !!(await c.partner.from("transactions").insert({ ...wage, personnel_id: null })).error);
  check("32 gün reddedilir", !!(await c.partner.from("transactions").insert({ ...wage, work_days: 32, amount: 48000 })).error);
  check("ayın 1'i olmayan hakediş tarihi reddedilir", !!(await c.partner.from("transactions").insert({ ...wage, period_month: "2026-09-15" })).error);
  check("kuruşlu tutar doğru yuvarlanır (3 × 333,33 = 999,99)", !(await c.partner.from("transactions").insert({ ...wage, work_days: 3, daily_rate: 333.33, amount: 999.99 })).error);
  for (const w of ["viewer", "admin", "outsider"] as Who[]) {
    check(`${w}: maaş ödemesi ekleyemez`, !!(await c[w].from("transactions").insert({ ...wage, user_id: ids[w] })).error);
  }
  check("üye olmayan maaş kaydını göremez", denied(await c.outsider.from("transactions").select("id").eq("id", w1.data!.id)));
  check("admin maaş kaydını görebilir (salt okunur)", (await c.admin.from("transactions").select("id").eq("id", w1.data!.id)).data?.length === 1);

  // Kasadan tutar değiştirilirse döküm temizlenmeli (uygulama davranışı): önce döküm silinmeden tutar değişimi reddedilir
  check("dökümü duran maaş kaydının tutarı tek başına değiştirilemez", !!(await c.partner.from("transactions").update({ amount: 100 }).eq("id", w1.data!.id).select("id")).error);
  const cleared = await c.partner.from("transactions").update({ amount: 100, work_days: null, daily_rate: null }).eq("id", w1.data!.id).select("id, personnel_id, period_month");
  check("döküm temizlenince tutar değişir, personel ve ay bağlantısı kalır", cleared.data?.length === 1 && cleared.data[0].personnel_id === personId && cleared.data[0].period_month === "2026-09-01", JSON.stringify(cleared));
  check("viewer maaş kaydını silemez", denied(await c.viewer.from("transactions").delete().eq("id", w1.data!.id).select("id")));
  check("ortak maaş kaydını silebilir", (await c.partner.from("transactions").delete().eq("id", w1.data!.id).select("id")).data?.length === 1);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  if (siteIds.length) await svc.from("sites").delete().in("id", siteIds);
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  check("test verisi temizlendi", !left.data?.length && !leftSites.data?.length);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
