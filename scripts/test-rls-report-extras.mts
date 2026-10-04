/** RLS/doğruluk testi: yeni rapor RPC'leri (get_fuel_report, get_machine_report, get_billing_report, get_billing_totals,
 *  get_site_overview). Ortağa özel veriler (yakıt, makine, malzeme, hakediş, fatura) ortakta yalnızca kendi kayıtlarını,
 *  adminde hepsini gösterir; şantiye dışındakiler hiçbir şey görmez. Rakamlar elle hesaplanmış değerlerle karşılaştırılır.
 *  Çalıştırma: npm run test:rls:report-extras  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const tag = randomBytes(4).toString("hex");
const pw = () => randomBytes(12).toString("base64url") + "aA1";
const accounts = { admin: { role: "admin" }, a: { role: "partner" }, b: { role: "partner" }, outsider: { role: "partner" } } as const;
type Who = keyof typeof accounts;
const cred = {} as Record<Who, { email: string; password: string }>;
const ids = {} as Record<Who, string>;
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);
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
  const { data: site } = await svc.from("sites").insert({ name: `Rapor ${tag}`, created_by: ids.a }).select("id").single();
  const siteId = site!.id as number;
  siteIds.push(siteId);
  await svc.from("site_members").insert([{ site_id: siteId, user_id: ids.a, role: "owner" }, { site_id: siteId, user_id: ids.b, role: "partner" }]);
  const { data: rentCat } = await svc.from("categories").select("id").is("site_id", null).eq("type", "expense").eq("name", "Kira (araç / ekipman)").single();

  // ---- Veri ----
  const mach = async (owner: Who, name: string, over: Record<string, unknown>) =>
    (await svc.from("machines").insert({ site_id: siteId, owner_id: ids[owner], name: `${name} ${tag}`, machine_type: "kamyon", identifier: name, ownership: "own", ...over }).select("id").single()).data!.id as number;
  const m1 = await mach("a", "A-Kiralik", { ownership: "rented", rate_unit: "day", rental_rate: 5000, supplier: "X" });
  const m2 = await mach("a", "A-Kendi", {});
  const mb = await mach("b", "B-Kendi", {});
  const att = (owner: Who, m: number, d: number, hours: number | null) => ({ site_id: siteId, owner_id: ids[owner], machine_id: m, work_date: day(d), hours });
  await svc.from("machine_attendance").insert([att("a", m1, 1, 8), att("a", m1, 2, 8), att("a", m1, 3, 8), att("a", m2, 1, 9), att("a", m2, 2, 9), att("b", mb, 1, 7)]);
  // kira ödemesi (a, makine m1): 2 gün × 5000
  await svc.from("transactions").insert({ site_id: siteId, user_id: ids.a, type: "expense", description: "Kira", amount: 10000, transaction_date: day(1), category_id: rentCat!.id, machine_id: m1, machine_qty: 2, machine_rate: 5000, machine_unit: "day" });
  // kasa (ortak kayıtlar): gelir 500000 (a), gider 20000 (b)
  await svc.from("transactions").insert([
    { site_id: siteId, user_id: ids.a, type: "income", description: "Hakediş", amount: 500000, transaction_date: day(2) },
    { site_id: siteId, user_id: ids.b, type: "expense", description: "Gider", amount: 20000, transaction_date: day(2) },
  ]);
  const fuel = (owner: Who, m: number, d: number, l: number, p: number) => ({ site_id: siteId, owner_id: ids[owner], machine_id: m, fuel_date: day(d), liters: l, unit_price: p });
  await svc.from("fuel_entries").insert([fuel("a", m1, 1, 100, 40), fuel("a", m1, 5, 50, 40), fuel("a", m2, 2, 50, 42), fuel("b", mb, 1, 20, 50)]);
  await svc.from("material_entries").insert([
    { site_id: siteId, entry_date: day(1), name: "Demir", unit: "ton", quantity: 2, unit_price: 30000, created_by: ids.a },
    { site_id: siteId, entry_date: day(1), name: "Kum", unit: "ton", quantity: 10, unit_price: 300, created_by: ids.b },
  ]);
  await svc.from("progress_payments").insert([
    { site_id: siteId, payment_date: day(3), amount: 300000, created_by: ids.a },
    { site_id: siteId, payment_date: day(3), amount: 50000, created_by: ids.b },
  ]);
  await svc.from("invoices").insert([
    { site_id: siteId, invoice_date: day(3), invoice_no: "F1", invoice_type: "malzeme", description: "Demir", amount: 100000, created_by: ids.a },
    { site_id: siteId, invoice_date: day(3), invoice_no: "F2", invoice_type: "malzeme", description: "Kum", amount: 10000, created_by: ids.b },
  ]);
  const { data: party } = await svc.from("parties").insert({ site_id: siteId, name: `Cari ${tag}`, category: "firma" }).select("id").single();
  await svc.from("goods_entries").insert({ site_id: siteId, entry_date: day(1), document_type: "irsaliye", party_id: party!.id, material_type: "Çimento", unit: "torba", quantity: 10, unit_price: 100, transport_cost: 200, created_by: ids.a });

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);
  const args = { p_site_id: siteId, p_from: day(30), p_to: today };
  type R = Record<string, unknown>;
  const rows = async (who: Who, fn: string, a: Record<string, unknown> = args) => ((await c[who].rpc(fn, a)).data ?? []) as R[];

  // ---- Yakıt ----
  const fa = await rows("a", "get_fuel_report");
  check("yakıt: ortak A yalnızca KENDİ araçlarını görür (2 araç, toplam 4000+2000+2100 = 8100)", fa.length === 2 && fa.reduce((s, r) => s + num(r.total), 0) === 8100, JSON.stringify(fa));
  check("yakıt: A'nın kiralık aracı 150 L, 6000 ₺, 2 alım", num(fa.find((r) => r.machine_id === m1)?.liters) === 150 && num(fa.find((r) => r.machine_id === m1)?.total) === 6000 && fa.find((r) => r.machine_id === m1)?.entry_count === 2);
  const fb = await rows("b", "get_fuel_report");
  check("yakıt: ortak B yalnızca kendi aracı (20 L × 50 = 1000)", fb.length === 1 && num(fb[0].total) === 1000 && fb[0].owner_id === ids.b, JSON.stringify(fb));
  const fadm = await rows("admin", "get_fuel_report");
  check("yakıt: admin tüm ortakları görür (3 araç, 9100) ve ortak adı gelir", fadm.length === 3 && fadm.reduce((s, r) => s + num(r.total), 0) === 9100 && fadm.every((r) => String(r.owner_name).startsWith("T ")), JSON.stringify(fadm.map((r) => r.owner_name)));
  check("yakıt: şantiye dışındaki kimse bir şey görmez", (await rows("outsider", "get_fuel_report")).length === 0);
  const fa3 = await rows("a", "get_fuel_report", { ...args, p_from: day(3) });
  check("yakıt: dönem filtresi çalışır (son 3 gün: 100 + 50 = 150 L)", fa3.reduce((s, r) => s + num(r.liters), 0) === 150, String(fa3.reduce((s, r) => s + num(r.liters), 0)));

  // ---- Makine ----
  const ma = await rows("a", "get_machine_report");
  const am1 = ma.find((r) => r.machine_id === m1), am2 = ma.find((r) => r.machine_id === m2);
  check("makine: A kiralık makine 3 gün × 5000 = 15000 hesaplanan, 10000 ödenen", am1?.days === 3 && num(am1?.due) === 15000 && num(am1?.paid) === 10000 && num(am1?.hours) === 24, JSON.stringify(am1));
  check("makine: kendi makinede kira 0, gün/saat görünür (2 gün, 18 saat)", am2?.days === 2 && num(am2?.due) === 0 && num(am2?.hours) === 18, JSON.stringify(am2));
  check("makine: A, B'nin makinesini görmez", !ma.some((r) => r.machine_id === mb) && ma.length === 2);
  check("makine: admin 3 makineyi görür", (await rows("admin", "get_machine_report")).length === 3);
  check("makine: B yalnızca kendi makinesini görür (1 gün, 7 saat)", (await rows("b", "get_machine_report")).length === 1);
  check("makine: dışarıdaki görmez", (await rows("outsider", "get_machine_report")).length === 0);
  check("makine: hareketsiz dönemde satır yok", (await rows("a", "get_machine_report", { ...args, p_from: day(400), p_to: day(300) })).length === 0);

  // ---- Hakediş / fatura ----
  const ba = await rows("a", "get_billing_report");
  check("hakediş/fatura: A yalnızca kendi ayını görür (300000 / 100000)", ba.length >= 1 && ba.every((r) => r.owner_id === ids.a) && ba.reduce((s, r) => s + num(r.progress), 0) === 300000 && ba.reduce((s, r) => s + num(r.invoices), 0) === 100000, JSON.stringify(ba));
  check("hakediş/fatura: admin hepsini görür (350000 / 110000)", (await rows("admin", "get_billing_report")).reduce((s, r) => s + num(r.progress), 0) === 350000 && (await rows("admin", "get_billing_report")).reduce((s, r) => s + num(r.invoices), 0) === 110000);
  const bt = await rows("b", "get_billing_totals", { p_site_id: siteId });
  check("hakediş/fatura: B'nin tüm zamanlar toplamı yalnızca kendisi (50000 / 10000)", bt.length === 1 && num(bt[0].progress) === 50000 && num(bt[0].invoices) === 10000, JSON.stringify(bt));
  check("hakediş/fatura: admin tüm zamanlar iki ortak satırı görür", (await rows("admin", "get_billing_totals", { p_site_id: siteId })).length === 2);
  check("hakediş/fatura: dışarıdaki görmez", (await rows("outsider", "get_billing_report")).length === 0 && (await rows("outsider", "get_billing_totals", { p_site_id: siteId })).length === 0);

  // ---- Genel özet ----
  const ov = async (who: Who, a: Record<string, unknown> = args) => ((await c[who].rpc("get_site_overview", a)).data ?? {}) as R;
  const oa = await ov("a");
  check("özet (A): kasa herkese ortak — gelir 500000, gider 30000 (10000 kira + 20000), 3 hareket", num(oa.cash_income) === 500000 && num(oa.cash_expense) === 30000 && num(oa.cash_count) === 3, JSON.stringify(oa));
  check("özet (A): kira ödemesi 10000", num(oa.rent_paid) === 10000);
  check("özet (A): yakıt yalnızca kendi — 3 alım, 200 L, 8100 ₺", num(oa.fuel_count) === 3 && num(oa.fuel_liters) === 200 && num(oa.fuel_total) === 8100, `${oa.fuel_count}/${oa.fuel_liters}/${oa.fuel_total}`);
  check("özet (A): malzeme yalnızca kendi (60000)", num(oa.material_total) === 60000 && num(oa.material_count) === 1);
  check("özet (A): makine puantajı yalnızca kendi (5 gün, 42 saat)", num(oa.machine_days) === 5 && num(oa.machine_hours) === 42);
  check("özet (A): hakediş/fatura dönem ve tüm zamanlar yalnızca kendi", num(oa.progress_total) === 300000 && num(oa.invoice_total) === 100000 && num(oa.progress_all) === 300000 && num(oa.invoice_all) === 100000);
  check("özet (A): irsaliye 1 kayıt, 1000 ₺ + 200 nakliye; 1 cari", num(oa.goods_count) === 1 && num(oa.goods_total) === 1000 && num(oa.goods_transport) === 200 && num(oa.party_count) === 1);
  const ob = await ov("b");
  check("özet (B): kendi özel verisi (yakıt 1000, malzeme 3000, hakediş 50000, makine 1 gün)", num(ob.fuel_total) === 1000 && num(ob.material_total) === 3000 && num(ob.progress_total) === 50000 && num(ob.machine_days) === 1, JSON.stringify(ob));
  const oadm = await ov("admin");
  check("özet (admin): tüm ortakların toplamı (yakıt 9100, malzeme 63000, hakediş 350000, makine 6 gün)", num(oadm.fuel_total) === 9100 && num(oadm.material_total) === 63000 && num(oadm.progress_total) === 350000 && num(oadm.machine_days) === 6, JSON.stringify(oadm));
  const oout = await ov("outsider");
  check("özet (dışarıdaki): her şey sıfır", Object.values(oout).every((v) => num(v) === 0), JSON.stringify(oout));
  check("özet: dönem dışı sıfır (kasa, yakıt) ama tüm zamanlar hakediş sürer", num((await ov("a", { ...args, p_from: day(400), p_to: day(300) })).cash_income) === 0 && num((await ov("a", { ...args, p_from: day(400), p_to: day(300) })).progress_all) === 300000);

  // ---- Oturumsuz erişim ----
  const anonC = createClient(url, anon, { auth: { persistSession: false } });
  for (const [fn, a] of [["get_fuel_report", args], ["get_machine_report", args], ["get_billing_report", args], ["get_billing_totals", { p_site_id: siteId }], ["get_site_overview", args]] as const) {
    check(`oturumsuz kullanıcı ${fn} çağıramaz`, !!(await anonC.rpc(fn, a as Record<string, unknown>)).error);
  }
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).stack ?? e).slice(0, 700));
} finally {
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  check("test verisi temizlendi", !delErr && !left.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
