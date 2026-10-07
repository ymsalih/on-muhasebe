/** RLS/doğruluk testi: cheques (çek takibi), get_cheque_summary / get_cheque_alerts / get_cheque_owners RPC'leri ve
 *  şantiye/ortak silme kurallarına entegrasyon. Her ortağın çekleri kendine özeldir; admin salt okur.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:cheques  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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
/** bugünden n gün sonrası (negatif = geçmiş) */
const at = (n: number) => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
const code = (r: { error: { code?: string } | null }) => r.error?.code;
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
  const siteC = await mkSite("C", [["owner", "owner"]]);
  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  const ch = (who: Who, over: Record<string, unknown> = {}, site = siteA) => ({
    site_id: site, owner_id: ids[who], direction: "received", counterparty: "Yılmaz İnşaat", amount: 1000, due_date: at(5), cheque_no: "A-100", bank: "Ziraat", ...over,
  });
  const bad = (name: string, r: { error: { code?: string } | null }, expected?: string) => check(name, !!r.error && (!expected || r.error.code === expected), JSON.stringify(r.error));
  const ins = (who: Who, over: Record<string, unknown> = {}, site = siteA) => c[who].from("cheques").insert(ch(who, over, site)).select("id").single();

  // ---------- ekleme ----------
  const c1 = await ins("owner", { amount: 10000, due_date: at(3), counterparty: "Müşteri A" });
  const c2 = await ins("owner", { direction: "given", amount: 5000, due_date: at(10), counterparty: "Tedarikçi B" });
  const c3 = await ins("owner", { direction: "given", amount: 2500, due_date: at(-2), counterparty: "Nakliyeci C" });
  const c4 = await ins("owner", { amount: 7000, due_date: at(0), counterparty: "Müşteri D" });
  const c5 = await ins("owner", { amount: 4000, due_date: at(-5), status: "settled", settled_date: at(-4), counterparty: "Müşteri E" });
  const c6 = await ins("owner", { amount: 900, due_date: at(-1), status: "bounced", counterparty: "Müşteri F" });
  const c7 = await ins("owner", { amount: 1200, due_date: at(7), counterparty: "Müşteri G" });
  const c8 = await ins("owner", { amount: 300, due_date: at(8), counterparty: "Müşteri H" });
  check("sahip alınan ve verilen çek ekleyebilir (8 kayıt)", [c1, c2, c3, c4, c5, c6, c7, c8].every((r) => !r.error), JSON.stringify([c1, c2, c3, c4, c5, c6, c7, c8].map((r) => r.error?.message)));
  const cp = await ins("partner", { amount: 777, due_date: at(2), counterparty: "Ortak müşteri" });
  check("ortak kendi çekini ekleyebilir", !cp.error, cp.error?.message);

  // ---------- doğrulama ----------
  bad("sıfır tutar reddedilir", await ins("owner", { amount: 0 }), "23514");
  bad("negatif tutar reddedilir", await ins("owner", { amount: -5 }), "23514");
  bad("geçersiz yön reddedilir", await ins("owner", { direction: "ters" }), "23514");
  bad("geçersiz durum reddedilir", await ins("owner", { status: "kayip" }), "23514");
  bad("kısa karşı taraf reddedilir", await ins("owner", { counterparty: "x" }), "23514");
  bad("karşı tarafsız çek reddedilir", await ins("owner", { counterparty: null }));
  bad("vadesiz çek reddedilir", await ins("owner", { due_date: null }));
  bad("düzenleme tarihi vadeden sonra olamaz", await ins("owner", { issue_date: at(10), due_date: at(5) }), "23514");
  bad("tahsil edildi durumu tarihsiz reddedilir", await ins("owner", { status: "settled" }), "23514");
  bad("bekleyen çekte tahsil tarihi yazılamaz", await ins("owner", { status: "pending", settled_date: at(0) }), "23514");
  check("düzenleme tarihi vadeyle aynı gün olabilir", !(await ins("owner", { issue_date: at(5), due_date: at(5), amount: 1 })).error);
  await svc.from("cheques").delete().eq("amount", 1).eq("site_id", siteA);
  check("tüm durumlar kabul edilir (bekliyor, karşılıksız, iptal, tahsil)", !(await ins("owner", { status: "cancelled", amount: 2 })).error);
  await svc.from("cheques").delete().in("amount", [2]).eq("site_id", siteA);
  bad("başkası adına (owner_id) çek yazılamaz", await c.partner.from("cheques").insert(ch("owner")).select("id").single());
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: çek ekleyemez`, !!(await ins(w)).error);
  }

  // ---------- okuma yalıtımı ----------
  const cnt = async (w: Who) => ((await c[w].from("cheques").select("id").eq("site_id", siteA)).data ?? []).length;
  check("sahip yalnızca kendi 8 çekini görür", (await cnt("owner")) === 8, String(await cnt("owner")));
  check("ortak yalnızca kendi 1 çekini görür (sahibinkini görmez)", (await cnt("partner")) === 1);
  check("admin tüm ortakların çeklerini (9) salt okur", (await cnt("admin")) === 9, String(await cnt("admin")));
  for (const w of ["viewer", "outsider", "owner2"] as Who[]) check(`${w}: hiçbir çek göremez`, (await cnt(w)) === 0);
  check("oturumsuz kullanıcı tabloyu okuyamaz", !!(await createClient(url, anon, { auth: { persistSession: false } }).from("cheques").select("id").limit(1)).error);

  // ---------- güncelleme ----------
  check("sahip çeki tahsil edildi olarak işaretler (durum + tarih)", (await c.owner.from("cheques").update({ status: "settled", settled_date: at(0) }).eq("id", c8.data!.id).select("id")).data?.length === 1);
  bad("durumu bekliyora çevirirken tarih temizlenmezse reddedilir", await c.owner.from("cheques").update({ status: "pending" }).eq("id", c8.data!.id), "23514");
  check("sahip bekliyora geri alır (durum + tarih temizlenir)", (await c.owner.from("cheques").update({ status: "pending", settled_date: null }).eq("id", c8.data!.id).select("id")).data?.length === 1);
  check("sahip tutar, vade ve karşı tarafı güncelleyebilir", (await c.owner.from("cheques").update({ amount: 310, due_date: at(9), counterparty: "Müşteri H2", bank: "Garanti" }).eq("id", c8.data!.id).select("id")).data?.length === 1);
  await c.owner.from("cheques").update({ amount: 300, due_date: at(8) }).eq("id", c8.data!.id);
  check("sahip yönü (alınan/verilen) düzeltebilir", (await c.owner.from("cheques").update({ direction: "given" }).eq("id", c8.data!.id).select("id")).data?.length === 1);
  await c.owner.from("cheques").update({ direction: "received" }).eq("id", c8.data!.id);
  bad("owner_id değiştirilemez (sütun yetkisi)", await c.owner.from("cheques").update({ owner_id: ids.partner }).eq("id", c1.data!.id));
  bad("site_id değiştirilemez (sütun yetkisi)", await c.owner.from("cheques").update({ site_id: siteC }).eq("id", c1.data!.id));
  check("ortak, sahibin çekini güncelleyemez", denied(await c.partner.from("cheques").update({ amount: 1 }).eq("id", c1.data!.id).select("id")));
  for (const w of ["viewer", "admin", "outsider"] as Who[]) check(`${w}: çek güncelleyemez`, denied(await c[w].from("cheques").update({ amount: 1 }).eq("id", c1.data!.id).select("id")));

  // ---------- özet RPC ----------
  // Bekleyenler — alınan: c1 10000, c4 7000, c7 1200, c8 300 = 18500 (4); verilen: c2 5000, c3 2500 = 7500 (2)
  // Yaklaşan (bugün..+7): c1, c4, c7 = 3 adet, alınan 18200; vadesi geçmiş: c3 = 1 adet, verilen 2500. c5 (tahsil) ve c6 (karşılıksız) sayılmaz.
  const sum = async (who: Who, owner: Who = "owner", days = 7) => ((await c[who].rpc("get_cheque_summary", { p_site_id: siteA, p_owner: ids[owner], p_days: days })).data ?? {}) as Record<string, unknown>;
  const so = await sum("owner");
  check("özet: bekleyen alınan 4 çek, 18500", so.received_count === 4 && num(so.received_total) === 18500, JSON.stringify(so));
  check("özet: bekleyen verilen 2 çek, 7500", so.given_count === 2 && num(so.given_total) === 7500);
  check("özet: yaklaşan (bugün..+7 dahil sınırlar) 3 çek, alınan 18200, verilen 0", so.soon_count === 3 && num(so.soon_received) === 18200 && num(so.soon_given) === 0, JSON.stringify(so));
  check("özet: vadesi geçmiş 1 çek, verilen 2500", so.overdue_count === 1 && num(so.overdue_given) === 2500 && num(so.overdue_received) === 0);
  check("özet: tahsil edilen ve karşılıksız çekler bekleyenlere girmez", num(so.received_total) + num(so.given_total) === 26000);
  check("özet: pencere 30 gün olunca 8. ve 10. gündekiler de yaklaşan (5 çek)", (await sum("owner", "owner", 30)).soon_count === 5);
  check("özet: ortak, sahibin özetini göremez (sıfır)", (await sum("partner")).received_count === 0 && (await sum("partner")).given_count === 0);
  check("özet: admin sahibin özetini görür", (await sum("admin")).received_count === 4);
  check("özet: şantiye dışındaki sıfır görür", (await sum("outsider")).received_count === 0);
  check("özet: ortak kendi çekini görür (1, 777)", (await sum("partner", "partner")).received_count === 1 && num((await sum("partner", "partner")).received_total) === 777);
  check("oturumsuz özet çağıramaz", !!(await createClient(url, anon, { auth: { persistSession: false } }).rpc("get_cheque_summary", { p_site_id: siteA, p_owner: ids.owner })).error);

  // ---------- uyarı RPC'si ----------
  const alerts = async (who: Who, site: number | null = null, days = 7) => ((await c[who].rpc("get_cheque_alerts", { p_site_id: site, p_days: days })).data ?? []) as { id: number; site_id: number; site_name: string; direction: string; counterparty: string; amount: string; due_date: string; days_left: number }[];
  const ao = await alerts("owner", siteA);
  check("uyarılar: vadesi geçmiş ve ≤7 gündekiler, en yakın vade önce (c3 −2, c4 0, c1 3, c7 7)", JSON.stringify(ao.map((a) => a.id)) === JSON.stringify([c3.data!.id, c4.data!.id, c1.data!.id, c7.data!.id]) && JSON.stringify(ao.map((a) => a.days_left)) === JSON.stringify([-2, 0, 3, 7]), JSON.stringify(ao.map((a) => [a.id, a.days_left])));
  check("uyarılar: tahsil/karşılıksız/ileri vadeli çek yok, tutar ve karşı taraf gelir", !ao.some((a) => [c5, c6, c2, c8].some((x) => x.data!.id === a.id)) && ao[0].counterparty === "Nakliyeci C" && num(ao[0].amount) === 2500 && ao[0].direction === "given");
  check("uyarılar: 30 günlük pencerede 6 çek (c2 ve c8 dahil)", (await alerts("owner", siteA, 30)).length === 6);
  check("uyarılar: ortak yalnızca kendi çekini görür (777, 2 gün)", JSON.stringify((await alerts("partner", siteA)).map((a) => [num(a.amount), a.days_left])) === JSON.stringify([[777, 2]]));
  const cc = await ins("owner", { amount: 555, due_date: at(1), counterparty: "C şantiyesi müşterisi" }, siteC);
  const all = await alerts("owner", null);
  check("uyarılar: şantiye süzgeci olmadan tüm şantiyeler, şantiye adıyla (5 çek)", all.length === 5 && all.some((a) => a.site_id === siteC && a.site_name === `C ${tag}`), JSON.stringify(all.map((a) => [a.site_id, a.id])));
  check("uyarılar: şantiye süzgeci yalnızca o şantiye", (await alerts("owner", siteC)).length === 1);
  check("uyarılar: admin kendi adına uyarı görmez (çek sahibi değil)", (await alerts("admin", null)).length === 0);
  for (const w of ["viewer", "outsider", "owner2"] as Who[]) check(`uyarılar: ${w} boş döner`, (await alerts(w, null)).length === 0);
  check("oturumsuz uyarı çağıramaz", !!(await createClient(url, anon, { auth: { persistSession: false } }).rpc("get_cheque_alerts", { p_site_id: null, p_days: 7 })).error);

  // ---------- ortak listesi RPC ----------
  const ownersOf = async (w: Who) => ((await c[w].rpc("get_cheque_owners", { p_site_id: siteA })).data ?? []) as { owner_id: string; full_name: string }[];
  const oa = await ownersOf("admin");
  check("admin: çeki olan 2 ortağı adıyla görür", oa.length === 2 && oa.some((o) => o.owner_id === ids.owner) && oa.some((o) => o.owner_id === ids.partner && o.full_name === `T partner ${tag}`), JSON.stringify(oa));
  check("ortak: yalnızca kendini görür", (await ownersOf("partner")).length === 1 && (await ownersOf("partner"))[0].owner_id === ids.partner);
  check("şantiye dışındaki: boş liste", (await ownersOf("outsider")).length === 0);

  // ---------- arşivdeki şantiye: çek yazılamaz, uyarı sürer ----------
  await c.owner.rpc("set_site_archived", { p_site_id: siteA, p_archived: true });
  bad("ARŞİVDE: çek eklenemez", await ins("owner", { amount: 3 }));
  check("ARŞİVDE: çek güncellenemez", denied(await c.owner.from("cheques").update({ amount: 3 }).eq("id", c1.data!.id).select("id")));
  check("ARŞİVDE: çek silinemez", denied(await c.owner.from("cheques").delete().eq("id", c1.data!.id).select("id")));
  check("ARŞİVDE: bekleyen çeklerin uyarısı sürer (unutulmasın)", (await alerts("owner", siteA)).length === 4);
  check("ARŞİVDE: çekler okunabilir", (await cnt("owner")) === 8);
  await c.owner.rpc("set_site_archived", { p_site_id: siteA, p_archived: false });
  check("arşivden çıkınca yazma geri gelir", !(await ins("owner", { amount: 4 })).error);
  await c.owner.from("cheques").delete().eq("amount", 4).eq("site_id", siteA);

  // ---------- silme ----------
  check("ortak, sahibin çekini silemez", denied(await c.partner.from("cheques").delete().eq("id", c1.data!.id).select("id")));
  for (const w of ["viewer", "admin", "outsider"] as Who[]) check(`${w}: çek silemez`, denied(await c[w].from("cheques").delete().eq("id", c1.data!.id).select("id")));
  check("sahip kendi çekini siler", (await c.owner.from("cheques").delete().eq("id", c6.data!.id).select("id")).data?.length === 1);

  // ---------- şantiye / ortak silme-arşiv kuralları: çekler "veri" sayılır ----------
  const siteOnlyCheque = await mkSite("SadeceCek", [["owner", "owner"]]);
  check("çeksiz boş şantiyede veri toplamı 0", (await c.owner.rpc("get_site_data_summary", { p_site_id: siteOnlyCheque })).data?.total === 0);
  await svc.from("cheques").insert(ch("owner", { amount: 99 }, siteOnlyCheque));
  const sumSite = (await c.owner.rpc("get_site_data_summary", { p_site_id: siteOnlyCheque })).data;
  check("veri özeti çekleri sayar (cheques = 1)", sumSite?.counts?.cheques === 1 && sumSite?.total === 1, JSON.stringify(sumSite));
  check("yalnızca ÇEKİ olan şantiye silinemez (55000)", code(await c.owner.rpc("delete_site", { p_site_id: siteOnlyCheque })) === "55000");
  check("çekler şantiye silme sonrası kaybolmadı", (await svc.from("cheques").select("id").eq("site_id", siteOnlyCheque)).data?.length === 1);
  const memberRow = (await svc.from("site_members").select("id").eq("site_id", siteA).eq("user_id", ids.partner).single()).data!;
  check("yalnızca ÇEKİ olan üye çıkarılamaz (55000) → arşive alınır", code(await c.owner.rpc("remove_site_member", { p_site_id: siteA, p_member_id: memberRow.id })) === "55000");
  const us = (await c.admin.rpc("get_user_data_summary", { p_user_id: ids.partner })).data;
  check("ortak hesabı özeti çekleri sayar (silme korunur)", us?.counts?.cheques === 1 && us?.total >= 1, JSON.stringify(us));
  void cc;
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).stack ?? e).slice(0, 700));
} finally {
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftC = siteIds.length ? await svc.from("cheques").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi (çekli şantiyeler CASCADE ile silinir)", !delErr && !left.data?.length && !leftSites.data?.length && !leftC.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
