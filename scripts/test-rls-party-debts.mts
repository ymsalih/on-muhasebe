/** RLS/doğruluk testi: party_debts (cari borç kayıtları), party_balances görünümünün yeni total_debt sütunu, get_party_debt_report RPC'si
 *  ve kalan borç hesabı (yazılan borç + irsaliye − ödeme). Cari şantiye bazlıdır (parties ile aynı yetki modeli).
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler; mevcut hiçbir gerçek kayda dokunmaz.
 *  Çalıştırma: npm run test:rls:party-debts  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { owedTotal, remainingDebt } from "../src/lib/parties/debt";

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
  owner2: { role: "partner" },
} as const;
type Who = keyof typeof accounts;
const cred = {} as Record<Who, { email: string; password: string }>;
const ids = {} as Record<Who, string>;
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);
const denied = (r: { error: unknown; data?: unknown }) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const day = (n: number) => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);

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
  const mkSite = async (name: string, members: [Who, string][]) => {
    const { data } = await svc.from("sites").insert({ name: `${name} ${tag}`, created_by: ids.owner }).select("id").single();
    siteIds.push(data!.id);
    await svc.from("site_members").insert(members.map(([w, role]) => ({ site_id: data!.id, user_id: ids[w], role })));
    return data!.id as number;
  };
  const siteA = await mkSite("A", [["owner", "owner"], ["partner", "partner"], ["viewer", "viewer"]]);
  const siteB = await mkSite("B", [["owner2", "owner"]]);
  const celik = (await svc.from("parties").insert({ site_id: siteA, name: `Çelik ${tag}`, category: "firma" }).select("id").single()).data!.id as number;
  const bos = (await svc.from("parties").insert({ site_id: siteA, name: `Borçsuz ${tag}`, category: "firma" }).select("id").single()).data!.id as number;
  const partyB = (await svc.from("parties").insert({ site_id: siteB, name: `B Cari ${tag}`, category: "firma" }).select("id").single()).data!.id as number;
  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  const debt = (who: Who, over: Record<string, unknown> = {}, party = celik, site = siteA) => ({ site_id: site, party_id: party, debt_date: today, amount: 100000, description: "Eski borç", created_by: ids[who], ...over });
  const bad = (name: string, r: { error: { code?: string } | null }, expected?: string) => check(name, !!r.error && (!expected || r.error.code === expected), JSON.stringify(r.error));

  // ---------- şema güvenliği: görünüm ve eski sütunlar ----------
  const view0 = await c.owner.from("party_balances").select("party_id, name, total_income, total_expense, balance, total_invoiced, total_debt").eq("site_id", siteA).eq("party_id", celik).single();
  check("yeni borç yokken görünüm: total_debt 0, eski sütunlar çalışır (bakiye 0)", !view0.error && num(view0.data?.total_debt) === 0 && num(view0.data?.balance) === 0 && num(view0.data?.total_invoiced) === 0, JSON.stringify(view0.error ?? view0.data));

  // ---------- ekleme ----------
  const d1 = await c.owner.from("party_debts").insert(debt("owner")).select("id").single();
  check("sahip cariye borç yazabilir (100.000 ₺)", !d1.error, d1.error?.message);
  const d2 = await c.partner.from("party_debts").insert(debt("partner", { amount: 5000, description: "Ek borç" })).select("id").single();
  check("ortak (yazma yetkili) da borç yazabilir", !d2.error, d2.error?.message);
  bad("sıfır tutar reddedilir", await c.owner.from("party_debts").insert(debt("owner", { amount: 0 })).select("id").single(), "23514");
  bad("negatif tutar reddedilir", await c.owner.from("party_debts").insert(debt("owner", { amount: -5 })).select("id").single(), "23514");
  bad("tarihsiz borç reddedilir", await c.owner.from("party_debts").insert(debt("owner", { debt_date: null })).select("id").single());
  bad("olmayan cariye borç yazılamaz (bileşik FK)", await c.owner.from("party_debts").insert(debt("owner", {}, 99999999)).select("id").single(), "23503");
  bad("başka şantiyenin carisine borç yazılamaz", await c.owner.from("party_debts").insert(debt("owner", {}, partyB)).select("id").single(), "23503");
  bad("başkası adına (created_by) borç yazılamaz", await c.partner.from("party_debts").insert(debt("owner")).select("id").single());
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: borç yazamaz`, !!(await c[w].from("party_debts").insert(debt(w)).select("id").single()).error);
  }

  // ---------- kalan borç hesabı: yazılan borç + irsaliye − ödeme ----------
  await svc.from("goods_entries").insert({ site_id: siteA, entry_date: day(1), document_type: "irsaliye", party_id: celik, material_type: "Demir", unit: "ton", quantity: 2, unit_price: 10000, transport_cost: 0, created_by: ids.owner });
  const pay = (amount: number, d: number) => ({ site_id: siteA, user_id: ids.owner, type: "expense", description: "Çelikçiye ödeme", amount, transaction_date: day(d), party_id: celik });
  await svc.from("transactions").insert(pay(30000, 2));
  const bal = async (who: Who = "owner") => (await c[who].from("party_balances").select("total_debt, total_invoiced, total_expense, total_income, balance").eq("site_id", siteA).eq("party_id", celik).single()).data as { total_debt: number; total_invoiced: number; total_expense: number; total_income: number; balance: number };
  let b = await bal();
  check("görünüm: yazılan borç 105.000, irsaliye 20.000, ödeme 30.000", num(b.total_debt) === 105000 && num(b.total_invoiced) === 20000 && num(b.total_expense) === 30000, JSON.stringify(b));
  check("görünüm: eski bakiye tanımı değişmedi (tahsilat − ödeme = −30.000)", num(b.balance) === -30000);
  const asNums = (x: typeof b) => ({ total_debt: num(x.total_debt), total_invoiced: num(x.total_invoiced), total_expense: num(x.total_expense) });
  check("toplam borç = yazılan 105.000 + irsaliye 20.000 = 125.000", owedTotal(asNums(b)) === 125000);
  check("kalan borç = 125.000 − 30.000 = 95.000", remainingDebt(asNums(b)) === 95000);
  await svc.from("transactions").insert(pay(25000, 1));
  b = await bal();
  check("YENİ ÖDEME 25.000 → kalan borç 70.000'e düşer (her ödeme borçtan düşer)", remainingDebt(asNums(b)) === 70000, JSON.stringify(b));
  await svc.from("transactions").insert(pay(80000, 0));
  b = await bal();
  check("borçtan fazla ödeme → kalan −10.000 (fazla ödeme)", remainingDebt(asNums(b)) === -10000);
  await svc.from("transactions").delete().eq("party_id", celik).eq("amount", 80000);
  check("ödeme silinince kalan borç geri artar (70.000)", remainingDebt(asNums(await bal())) === 70000);
  const other = (await c.owner.from("party_balances").select("total_debt").eq("site_id", siteA).eq("party_id", bos).single()).data;
  check("borcu olmayan cari etkilenmez (total_debt 0)", num(other?.total_debt) === 0);

  // ---------- okuma yalıtımı ----------
  const cnt = async (w: Who) => ((await c[w].from("party_debts").select("id").eq("site_id", siteA)).data ?? []).length;
  check("üyeler (sahip, ortak, viewer) borç kayıtlarını görür (2)", (await cnt("owner")) === 2 && (await cnt("partner")) === 2 && (await cnt("viewer")) === 2);
  check("admin tüm borç kayıtlarını salt okur", (await cnt("admin")) === 2);
  for (const w of ["outsider", "owner2"] as Who[]) check(`${w}: borç kaydı göremez`, (await cnt(w)) === 0);
  check("şantiye dışındaki görünümde cariyi/borcu göremez", ((await c.outsider.from("party_balances").select("party_id").eq("site_id", siteA)).data ?? []).length === 0);
  check("oturumsuz kullanıcı borç tablosunu okuyamaz", !!(await createClient(url, anon, { auth: { persistSession: false } }).from("party_debts").select("id").limit(1)).error);

  // ---------- güncelleme ----------
  check("sahip borcu düzenler (120.000, açıklama, tarih)", (await c.owner.from("party_debts").update({ amount: 120000, description: "Düzeltilmiş", debt_date: day(3) }).eq("id", d1.data!.id).select("id")).data?.length === 1);
  check("düzenleme görünüme yansır (toplam 125.000 yazılan)", num((await bal()).total_debt) === 125000);
  check("yazma yetkili ortak da düzenleyebilir", (await c.partner.from("party_debts").update({ description: "Ortak düzeltti" }).eq("id", d2.data!.id).select("id")).data?.length === 1);
  for (const w of ["viewer", "admin", "outsider"] as Who[]) check(`${w}: borç güncelleyemez`, denied(await c[w].from("party_debts").update({ amount: 1 }).eq("id", d1.data!.id).select("id")));
  bad("party_id değiştirilemez (sütun yetkisi)", await c.owner.from("party_debts").update({ party_id: bos }).eq("id", d1.data!.id));
  bad("site_id değiştirilemez", await c.owner.from("party_debts").update({ site_id: siteB }).eq("id", d1.data!.id));
  bad("created_by değiştirilemez", await c.owner.from("party_debts").update({ created_by: ids.partner }).eq("id", d1.data!.id));
  bad("sıfıra düzenlenemez", await c.owner.from("party_debts").update({ amount: 0 }).eq("id", d1.data!.id), "23514");

  // ---------- rapor RPC'si ----------
  const rep = async (who: Who, from: string, to: string) => ((await c[who].rpc("get_party_debt_report", { p_site_id: siteA, p_from: from, p_to: to })).data ?? []) as { party_id: number; total: string }[];
  const r1 = await rep("owner", day(30), today);
  check("rapor: dönemde cari başına yazılan borç (120.000 + 5.000 = 125.000)", r1.length === 1 && r1[0].party_id === celik && num(r1[0].total) === 125000, JSON.stringify(r1));
  check("rapor: dönem süzgeci (yalnızca bugün → 5.000; 120.000'lik kayıt 3 gün önce)", num((await rep("owner", today, today))[0]?.total) === 5000);
  check("rapor: dönem dışında boş", (await rep("owner", day(400), day(300))).length === 0);
  check("rapor: şantiye dışındaki boş görür", (await rep("outsider", day(30), today)).length === 0);
  check("oturumsuz rapor çağıramaz", !!(await createClient(url, anon, { auth: { persistSession: false } }).rpc("get_party_debt_report", { p_site_id: siteA, p_from: day(30), p_to: today })).error);

  // ---------- silme / koruma kuralları ----------
  bad("borç kaydı olan cari silinemez (geçmiş korunur)", await c.owner.from("parties").delete().eq("id", celik).select("id"), "23503");
  const sumSite = (await c.owner.rpc("get_site_data_summary", { p_site_id: siteA })).data;
  check("şantiye veri özeti borç kayıtlarını sayar (party_debts = 2)", sumSite?.counts?.party_debts === 2, JSON.stringify(sumSite?.counts));
  const sumUser = (await c.admin.rpc("get_user_data_summary", { p_user_id: ids.partner })).data;
  check("ortak hesabı özeti, ortağın yazdığı borç kaydını sayar (silme korunur)", sumUser?.counts?.party_debts === 1, JSON.stringify(sumUser?.counts));
  await c.owner.rpc("set_site_archived", { p_site_id: siteA, p_archived: true });
  bad("ARŞİVDE: borç yazılamaz", await c.owner.from("party_debts").insert(debt("owner", { amount: 7 })).select("id").single());
  check("ARŞİVDE: borç silinemez/güncellenemez", denied(await c.owner.from("party_debts").delete().eq("id", d2.data!.id).select("id")) && denied(await c.owner.from("party_debts").update({ amount: 2 }).eq("id", d2.data!.id).select("id")));
  check("ARŞİVDE: borçlar okunabilir", (await cnt("owner")) === 2);
  await c.owner.rpc("set_site_archived", { p_site_id: siteA, p_archived: false });
  check("sahip borç kaydını siler (kalan borç yeniden hesaplanır)", (await c.owner.from("party_debts").delete().eq("id", d2.data!.id).select("id")).data?.length === 1 && num((await bal()).total_debt) === 120000);
  check("ortak, başka bir kullanıcının kaydını (yazma yetkisi olduğu için) silebilir mi? → evet, aynı şantiyenin yazarı", (await c.partner.from("party_debts").delete().eq("id", d1.data!.id).select("id")).data?.length === 1);
  for (const w of ["viewer", "outsider"] as Who[]) check(`${w}: borç silemez`, denied(await c[w].from("party_debts").delete().eq("id", d1.data!.id).select("id")));
  check("tüm borçlar silinince total_debt 0'a döner, cari ve ödemeler yerinde", num((await bal()).total_debt) === 0 && num((await bal()).total_expense) === 55000);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).stack ?? e).slice(0, 700));
} finally {
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftD = siteIds.length ? await svc.from("party_debts").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi (yalnızca bu testin açtıkları)", !delErr && !left.data?.length && !leftSites.data?.length && !leftD.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
