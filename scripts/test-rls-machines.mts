/** RLS/bütünlük testi: machines, machine_attendance, set_machine_attendance / get_month_machine_attendance / get_machine_owners
 *  RPC'leri ve kira ödemesi (transactions.machine_*). Her ortağın makineleri kendine özeldir; admin salt okur.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:machines  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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
const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);

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
  const { data: rentCat } = await svc.from("categories").select("id").is("site_id", null).eq("type", "expense").eq("name", "Kira (araç / ekipman)").single();

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  const mc = (who: Who, over: Record<string, unknown> = {}) => ({ site_id: siteA, owner_id: ids[who], name: `CAT 320 ${tag}`, machine_type: "ekskavator", identifier: "34 ABC 123", ownership: "own", ...over });

  // ---------- makine kartı ----------
  const m1 = await c.owner.from("machines").insert(mc("owner")).select("id").single();
  check("sahip makine ekleyebilir", !m1.error, m1.error?.message);
  const m2 = await c.owner.from("machines").insert(mc("owner", { name: `Kiralık kepçe ${tag}`, machine_type: "kepce", identifier: "KP-1", ownership: "rented", supplier: "Yılmaz İnşaat", rate_unit: "day", rental_rate: 5000 })).select("id").single();
  check("sahip kiralık makine ekleyebilir (günlük 5000)", !m2.error, m2.error?.message);
  const m3 = await c.owner.from("machines").insert(mc("owner", { name: `Saatlik greyder ${tag}`, machine_type: "greyder", identifier: "GR-1", ownership: "rented", rate_unit: "hour", rental_rate: 900 })).select("id").single();
  check("saatlik kiralı makine eklenebilir", !m3.error, m3.error?.message);
  const p1 = await c.partner.from("machines").insert(mc("partner", { name: `Ortak kamyonu ${tag}`, machine_type: "kamyon" })).select("id").single();
  check("ortak kendi makinesini ekleyebilir", !p1.error, p1.error?.message);
  check("ortak, sahiple AYNI ad+plakada makine ekleyebilir (ortaklar bağımsız)", !(await c.partner.from("machines").insert(mc("partner"))).error);
  check("aynı ortağın aynı ad+plakası tekrar eklenemez", (await c.owner.from("machines").insert(mc("owner", { name: `cat 320 ${tag}`, identifier: "34 abc 123" }))).error?.code === "23505");

  const bad = (name: string, r: { error: { code?: string } | null }, code?: string) => check(name, !!r.error && (!code || r.error.code === code), JSON.stringify(r.error));
  bad("geçersiz makine türü reddedilir", await c.owner.from("machines").insert(mc("owner", { name: `X1 ${tag}`, machine_type: "uzay_gemisi", identifier: "a" })), "23514");
  bad("kısa ad reddedilir", await c.owner.from("machines").insert(mc("owner", { name: "x", identifier: "b" })), "23514");
  bad("kendi makinesine kira ücreti yazılamaz", await c.owner.from("machines").insert(mc("owner", { name: `X2 ${tag}`, identifier: "c", ownership: "own", rate_unit: "day", rental_rate: 100 })), "23514");
  bad("kira birimi ve tutarı birlikte olmalı", await c.owner.from("machines").insert(mc("owner", { name: `X3 ${tag}`, identifier: "d", ownership: "rented", rate_unit: "day" })), "23514");
  bad("bitiş tarihi başlangıçtan önce olamaz", await c.owner.from("machines").insert(mc("owner", { name: `X4 ${tag}`, identifier: "e", start_date: "2026-09-10", end_date: "2026-09-01" })), "23514");
  bad("geçersiz durum reddedilir", await c.owner.from("machines").insert(mc("owner", { name: `X5 ${tag}`, identifier: "f", status: "ucuyor" })), "23514");
  bad("başkası adına makine yazılamaz", await c.partner.from("machines").insert(mc("owner", { name: `X6 ${tag}`, identifier: "g" })));
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: makine ekleyemez`, !!(await c[w].from("machines").insert(mc(w, { name: `Y ${w} ${tag}` }))).error);
  }
  await c.owner2.from("machines").insert(mc("owner2", { site_id: siteB, name: `B makinesi ${tag}`, identifier: "B1" }));

  // ---------- gizlilik ----------
  const cnt = async (who: Who, site = siteA) => ((await c[who].from("machines").select("id").eq("site_id", site)).data ?? []).length;
  check("sahip yalnızca kendi 3 makinesini görür", (await cnt("owner")) === 3);
  check("ortak yalnızca kendi 2 makinesini görür", (await cnt("partner")) === 2);
  check("ortak, sahibin makinesini göremez", ((await c.partner.from("machines").select("id").eq("id", m1.data!.id)).data ?? []).length === 0);
  check("admin tüm ortakların makinelerini görür (5)", (await cnt("admin")) === 5);
  check("viewer hiçbir makine göremez", (await cnt("viewer")) === 0);
  check("üye olmayan hiçbir makine göremez", (await cnt("outsider")) === 0);
  check("başka şantiyenin sahibi A'yı göremez", (await cnt("owner2")) === 0);
  check("anonim okuyamaz", denied(await createClient(url, anon).from("machines").select("id")));

  // ---------- makine güncelleme/silme ----------
  check("sahip makinesini güncelleyebilir (durum: bakımda)", (await c.owner.from("machines").update({ status: "maintenance" }).eq("id", m1.data!.id).select("id")).data?.length === 1);
  await c.owner.from("machines").update({ status: "active" }).eq("id", m1.data!.id);
  check("ortak başkasının makinesini güncelleyemez", denied(await c.partner.from("machines").update({ name: "ele geçirme" }).eq("id", m1.data!.id).select("id")));
  check("admin makine güncelleyemez", denied(await c.admin.from("machines").update({ name: "admin x" }).eq("id", m1.data!.id).select("id")));
  check("makinenin şantiyesi/sahibi değiştirilemez", !!(await c.owner.from("machines").update({ site_id: siteB }).eq("id", m1.data!.id)).error && !!(await c.owner.from("machines").update({ owner_id: ids.partner }).eq("id", m1.data!.id)).error);

  // ---------- puantaj ----------
  const a = (who: Who, mid: number, over: Record<string, unknown> = {}) => ({ site_id: siteA, owner_id: ids[who], machine_id: mid, work_date: day(1), ...over });
  const att1 = await c.owner.from("machine_attendance").insert(a("owner", m1.data!.id, { hours: 8.5, note: "Temel kazısı" })).select("id").single();
  check("sahip makine puantajı ekleyebilir (8,5 saat, not)", !att1.error, att1.error?.message);
  check("saatsiz puantaj serbest", !(await c.owner.from("machine_attendance").insert(a("owner", m2.data!.id))).error);
  bad("aynı makine aynı gün iki kez işaretlenemez", await c.owner.from("machine_attendance").insert(a("owner", m1.data!.id)), "23505");
  bad("saat 0 reddedilir", await c.owner.from("machine_attendance").insert(a("owner", m1.data!.id, { work_date: day(2), hours: 0 })), "23514");
  bad("25 saat reddedilir", await c.owner.from("machine_attendance").insert(a("owner", m1.data!.id, { work_date: day(2), hours: 25 })), "23514");
  check("24 saat serbest", !(await c.owner.from("machine_attendance").insert(a("owner", m1.data!.id, { work_date: day(3), hours: 24 }))).error);
  check("gelecek tarihe puantaj yazılamaz", !!(await c.owner.from("machine_attendance").insert(a("owner", m1.data!.id, { work_date: tomorrow }))).error);
  check("ortak, sahibin makinesine puantaj yazamaz (sahip bileşik FK)", !!(await c.partner.from("machine_attendance").insert(a("partner", m1.data!.id, { work_date: day(4) }))).error);
  check("ortak, sahibin makinesine sahip adına da yazamaz (RLS)", !!(await c.partner.from("machine_attendance").insert(a("owner", m1.data!.id, { work_date: day(4) }))).error);
  check("ortak kendi makinesine puantaj yazar", !(await c.partner.from("machine_attendance").insert(a("partner", p1.data!.id))).error);
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: puantaj yazamaz`, !!(await c[w].from("machine_attendance").insert(a(w, m1.data!.id, { work_date: day(5) }))).error);
  }
  const acnt = async (who: Who) => ((await c[who].from("machine_attendance").select("id").eq("site_id", siteA)).data ?? []).length;
  check("sahip yalnızca kendi 3 puantajını görür", (await acnt("owner")) === 3);
  check("ortak yalnızca kendi 1 puantajını görür", (await acnt("partner")) === 1);
  check("admin tüm puantajları görür (4)", (await acnt("admin")) === 4);
  check("viewer/üye olmayan/başka şantiye puantaj göremez", (await acnt("viewer")) === 0 && (await acnt("outsider")) === 0 && (await acnt("owner2")) === 0);

  check("sahip saat ve notu güncelleyebilir", (await c.owner.from("machine_attendance").update({ hours: 6, note: "Güncel" }).eq("id", att1.data!.id).select("id")).data?.length === 1);
  check("ortak başkasının puantajını güncelleyemez", denied(await c.partner.from("machine_attendance").update({ hours: 1 }).eq("id", att1.data!.id).select("id")));
  check("admin puantaj güncelleyemez", denied(await c.admin.from("machine_attendance").update({ hours: 1 }).eq("id", att1.data!.id).select("id")));
  check("puantajın makinesi/günü değiştirilemez", !!(await c.owner.from("machine_attendance").update({ machine_id: m2.data!.id }).eq("id", att1.data!.id)).error && !!(await c.owner.from("machine_attendance").update({ work_date: day(9) }).eq("id", att1.data!.id)).error);

  // ---------- toplu işaretleme RPC ----------
  const rpc = (who: Who, add: number[], remove: number[], date = day(6), site = siteA) => c[who].rpc("set_machine_attendance", { p_site_id: site, p_work_date: date, p_add: add, p_remove: remove });
  check("RPC: sahip iki makineyi işaretler", !(await rpc("owner", [m1.data!.id, m2.data!.id], [])).error);
  check("RPC: işaret satırları yazıldı (2)", ((await svc.from("machine_attendance").select("id").eq("work_date", day(6)).eq("site_id", siteA)).data ?? []).length === 2);
  check("RPC: tekrar ekleme yok sayılır", !(await rpc("owner", [m1.data!.id], [])).error);
  check("RPC: bir makineyi kaldırır", !(await rpc("owner", [], [m2.data!.id])).error && ((await svc.from("machine_attendance").select("id").eq("work_date", day(6)).eq("site_id", siteA)).data ?? []).length === 1);
  check("RPC: ortak, sahibin makinesini işaretleyemez", !!(await rpc("partner", [m1.data!.id], [])).error);
  check("RPC: ortak başkasının işaretini kaldıramaz (etkisiz)", !(await rpc("partner", [], [m1.data!.id])).error && ((await svc.from("machine_attendance").select("id").eq("work_date", day(6)).eq("machine_id", m1.data!.id)).data ?? []).length === 1);
  check("RPC: viewer işaretleyemez", !!(await rpc("viewer", [m1.data!.id], [])).error);
  check("RPC: admin işaretleyemez", !!(await rpc("admin", [m1.data!.id], [])).error);
  check("RPC: üye olmayan işaretleyemez", !!(await rpc("outsider", [m1.data!.id], [])).error);
  check("RPC: gelecek tarih reddedilir", !!(await rpc("owner", [m1.data!.id], [], tomorrow)).error);
  check("RPC: anonim çağıramaz", !!(await createClient(url, anon).rpc("set_machine_attendance", { p_site_id: siteA, p_work_date: day(6), p_add: [], p_remove: [] })).error);

  // ---------- aylık özet RPC ----------
  const first = day(30), last = today;
  const mo = await c.owner.rpc("get_month_machine_attendance", { p_site_id: siteA, p_owner: ids.owner, p_first: first, p_last: last });
  const row1 = (mo.data as { machine_id: number; days: Record<string, { h: number | null; n: string | null }> }[] | null)?.find((r) => r.machine_id === m1.data!.id);
  check("aylık özet: makine 1'in günleri, saat ve notları JSON'da", !!row1 && row1.days[day(1)]?.h === 6 && row1.days[day(1)]?.n === "Güncel" && row1.days[day(3)]?.h === 24 && Object.keys(row1.days).length === 3, JSON.stringify(row1));
  check("aylık özet: saatsiz gün h=null", (mo.data as { machine_id: number; days: Record<string, { h: number | null }> }[]).find((r) => r.machine_id === m2.data!.id)?.days[day(1)]?.h === null);
  check("aylık özet: ortak sahibin özetini göremez (boş)", ((await c.partner.rpc("get_month_machine_attendance", { p_site_id: siteA, p_owner: ids.owner, p_first: first, p_last: last })).data as unknown[])?.length === 0);
  check("aylık özet: admin sahibin özetini görür", ((await c.admin.rpc("get_month_machine_attendance", { p_site_id: siteA, p_owner: ids.owner, p_first: first, p_last: last })).data as unknown[])?.length === 2);
  check("aylık özet: üye olmayan boş görür", ((await c.outsider.rpc("get_month_machine_attendance", { p_site_id: siteA, p_owner: ids.owner, p_first: first, p_last: last })).data as unknown[])?.length === 0);
  check("aylık özet: anonim çağıramaz", !!(await createClient(url, anon).rpc("get_month_machine_attendance", { p_site_id: siteA, p_owner: ids.owner, p_first: first, p_last: last })).error);
  const ow = (await c.admin.rpc("get_machine_owners", { p_site_id: siteA })).data as { owner_id: string; full_name: string }[];
  check("makine sahipleri (admin): 2 ortak, isimleriyle", ow?.length === 2 && ow.some((o) => o.owner_id === ids.partner && o.full_name === `T partner ${tag}`), JSON.stringify(ow));
  check("makine sahipleri (ortak): yalnızca kendisi", ((await c.partner.rpc("get_machine_owners", { p_site_id: siteA })).data as unknown[])?.length === 1);
  check("makine sahipleri: üye olmayan boş", ((await c.outsider.rpc("get_machine_owners", { p_site_id: siteA })).data as unknown[])?.length === 0);

  // ---------- kira ödemesi (transactions.machine_*) ----------
  const tx = (who: Who, over: Record<string, unknown> = {}) => ({
    site_id: siteA, user_id: ids[who], type: "expense", description: "Eylül kirası", amount: 100000, transaction_date: today, category_id: rentCat!.id,
    machine_id: m2.data!.id, machine_qty: 20, machine_rate: 5000, machine_unit: "day", period_month: `${today.slice(0, 7)}-01`, ...over,
  });
  const r1 = await c.owner.from("transactions").insert(tx("owner")).select("id").single();
  check("sahip kira ödemesi ekler (20 gün × 5000 = 100000)", !r1.error, r1.error?.message);
  check("saatlik kira ödemesi (7,5 saat × 900 = 6750)", !(await c.owner.from("transactions").insert(tx("owner", { machine_id: m3.data!.id, machine_qty: 7.5, machine_rate: 900, machine_unit: "hour", amount: 6750 }))).error);
  bad("tutar miktar × ücretle uyuşmazsa reddedilir", await c.owner.from("transactions").insert(tx("owner", { amount: 99999 })), "23514");
  bad("miktar sıfır reddedilir", await c.owner.from("transactions").insert(tx("owner", { machine_qty: 0, amount: 0 })), "23514");
  bad("geçersiz birim reddedilir", await c.owner.from("transactions").insert(tx("owner", { machine_unit: "yil" })), "23514");
  bad("makinesiz miktar dökümü reddedilir", await c.owner.from("transactions").insert(tx("owner", { machine_id: null })), "23514");
  bad("gelire makine bağlanamaz", await c.owner.from("transactions").insert(tx("owner", { type: "income", category_id: null })), "23514");
  bad("ortak, sahibin makinesine kira ödemesi bağlayamaz (trigger)", await c.partner.from("transactions").insert(tx("partner")), "23503");
  bad("başka şantiyenin makinesine bağlanamaz (bileşik FK)", await c.owner.from("transactions").insert(tx("owner", { machine_id: (await svc.from("machines").select("id").eq("site_id", siteB).single()).data!.id })), "23503");
  check("viewer/admin kira ödemesi ekleyemez", !!(await c.viewer.from("transactions").insert(tx("viewer"))).error && !!(await c.admin.from("transactions").insert(tx("admin"))).error);
  check("kasadan tutar değişince döküm temizlenebilir (miktar/ücret/birim boş, makine kalır)", (await c.owner.from("transactions").update({ amount: 90000, machine_qty: null, machine_rate: null, machine_unit: null }).eq("id", r1.data!.id).select("id")).data?.length === 1);
  bad("döküm temizlenmeden tutar değiştirilemez", await c.owner.from("transactions").update({ machine_qty: 20, machine_rate: 5000, machine_unit: "day" }).eq("id", r1.data!.id));
  await c.owner.from("transactions").update({ amount: 100000, machine_qty: 20, machine_rate: 5000, machine_unit: "day" }).eq("id", r1.data!.id);

  // ---------- silme ----------
  bad("kira ödemesi olan makine silinemez", await c.owner.from("machines").delete().eq("id", m2.data!.id), "23503");
  check("ortak, sahibin makinesini silemez", denied(await c.partner.from("machines").delete().eq("id", m1.data!.id).select("id")));
  check("admin makine silemez", denied(await c.admin.from("machines").delete().eq("id", m1.data!.id).select("id")));
  check("ödemesi olmayan makine silinince puantajı da silinir (CASCADE)", (await c.owner.from("machines").delete().eq("id", m1.data!.id).select("id")).data?.length === 1 && ((await svc.from("machine_attendance").select("id").eq("machine_id", m1.data!.id)).data ?? []).length === 0);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftM = siteIds.length ? await svc.from("machines").select("id").in("site_id", siteIds) : { data: [] };
  const leftA = siteIds.length ? await svc.from("machine_attendance").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi (kira ödemeli makineli şantiye CASCADE ile silinir)", !delErr && !left.data?.length && !leftSites.data?.length && !leftM.data?.length && !leftA.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
