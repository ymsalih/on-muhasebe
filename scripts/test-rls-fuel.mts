/** RLS/bütünlük testi: fuel_entries (yakıt takibi) ve get_fuel_summary RPC'si. Her ortağın yakıt kayıtları kendine özeldir
 *  (iş makineleri gibi); kayıt ortağın KENDİ makinesine bağlanır; admin salt okur. Toplam tutar = litre × litre fiyatı (veritabanı).
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:fuel  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  // Makineler (servis anahtarıyla; makine RLS'i machines testinde)
  const mkMachine = async (site: number, who: Who, name: string) => {
    const { data, error } = await svc.from("machines").insert({ site_id: site, owner_id: ids[who], name: `${name} ${tag}`, machine_type: "kamyon", identifier: name, ownership: "own" }).select("id").single();
    if (error) throw error;
    return data!.id as number;
  };
  const mOwner1 = await mkMachine(siteA, "owner", "K1");
  const mOwner2 = await mkMachine(siteA, "owner", "K2");
  const mPartner = await mkMachine(siteA, "partner", "P1");
  const mB = await mkMachine(siteB, "owner2", "B1");

  const fe = (who: Who, machine: number, over: Record<string, unknown> = {}) => ({
    site_id: siteA, owner_id: ids[who], machine_id: machine, fuel_date: day(1), fuel_type: "motorin", liters: 50, unit_price: 42.5, fueled_by: "Ahmet", station: "Petrol A", ...over,
  });
  const bad = (name: string, r: { error: { code?: string } | null }, code?: string) => check(name, !!r.error && (!code || r.error.code === code), JSON.stringify(r.error));

  // ---------- ekleme ----------
  const f1 = await c.owner.from("fuel_entries").insert(fe("owner", mOwner1)).select("id, total_amount").single();
  check("sahip kendi aracına yakıt ekleyebilir", !f1.error, f1.error?.message);
  check("toplam tutar = litre × litre fiyatı (50 × 42,50 = 2125)", Number(f1.data?.total_amount) === 2125, String(f1.data?.total_amount));
  const f2 = await c.owner.from("fuel_entries").insert(fe("owner", mOwner1, { fuel_date: day(3), liters: 33.33, unit_price: 41.99 })).select("id, total_amount").single();
  check("kuruşa yuvarlama (33,33 × 41,99 = 1399,5267 → 1399,53)", Number(f2.data?.total_amount) === 1399.53, String(f2.data?.total_amount));
  const f3 = await c.owner.from("fuel_entries").insert(fe("owner", mOwner2, { fuel_date: day(40), liters: 100, unit_price: 40, fuel_type: "benzin" })).select("id").single();
  check("sahip ikinci araca ve başka tarihe yakıt ekleyebilir", !f3.error, f3.error?.message);
  const fp = await c.partner.from("fuel_entries").insert(fe("partner", mPartner, { liters: 10, unit_price: 50 })).select("id").single();
  check("ortak kendi aracına yakıt ekleyebilir", !fp.error, fp.error?.message);

  bad("toplam tutar elle yazılamaz (otomatik hesaplanan sütun)", await c.owner.from("fuel_entries").insert(fe("owner", mOwner1, { total_amount: 1 })));
  bad("litre sıfır olamaz", await c.owner.from("fuel_entries").insert(fe("owner", mOwner1, { liters: 0 })), "23514");
  bad("litre negatif olamaz", await c.owner.from("fuel_entries").insert(fe("owner", mOwner1, { liters: -5 })), "23514");
  bad("litre fiyatı negatif olamaz", await c.owner.from("fuel_entries").insert(fe("owner", mOwner1, { unit_price: -1 })), "23514");
  bad("geçersiz yakıt türü reddedilir", await c.owner.from("fuel_entries").insert(fe("owner", mOwner1, { fuel_type: "su" })), "23514");
  bad("gelecek tarihli yakıt kaydı girilemez", await c.owner.from("fuel_entries").insert(fe("owner", mOwner1, { fuel_date: tomorrow })), "42501");
  bad("olmayan araç reddedilir (bileşik FK)", await c.owner.from("fuel_entries").insert(fe("owner", 99999999)), "23503");
  bad("ortak, sahibin aracına yakıt yazamaz (bileşik FK: araç ortağa ait olmalı)", await c.partner.from("fuel_entries").insert(fe("partner", mOwner1)), "23503");
  bad("başkası adına (owner_id) kayıt yazılamaz", await c.partner.from("fuel_entries").insert(fe("owner", mOwner1)));
  bad("başka şantiyenin aracına bağlanamaz", await c.owner.from("fuel_entries").insert(fe("owner", mB)), "23503");
  for (const w of ["viewer", "admin", "outsider"] as Who[]) {
    check(`${w}: yakıt ekleyemez`, !!(await c[w].from("fuel_entries").insert(fe(w, mOwner1))).error);
  }
  check("başka şantiyenin sahibi bu şantiyeye yazamaz", !!(await c.owner2.from("fuel_entries").insert(fe("owner2", mB, { site_id: siteA }))).error);

  // ---------- okuma yalıtımı ----------
  const own = await c.owner.from("fuel_entries").select("id").eq("site_id", siteA);
  check("sahip yalnızca kendi 3 kaydını görür", own.data?.length === 3, String(own.data?.length));
  const par = await c.partner.from("fuel_entries").select("id").eq("site_id", siteA);
  check("ortak yalnızca kendi 1 kaydını görür (sahibinkini görmez)", par.data?.length === 1 && par.data[0].id === fp.data?.id, String(par.data?.length));
  const adm = await c.admin.from("fuel_entries").select("id").eq("site_id", siteA);
  check("admin tüm ortakların kayıtlarını (4) salt okur", adm.data?.length === 4, String(adm.data?.length));
  for (const w of ["viewer", "outsider", "owner2"] as Who[]) {
    check(`${w}: hiçbir yakıt kaydı göremez`, ((await c[w].from("fuel_entries").select("id").eq("site_id", siteA)).data ?? []).length === 0);
  }

  // ---------- güncelleme ----------
  check("sahip kendi kaydını güncelleyebilir (litre/fiyat → tutar yeniden hesaplanır)", (await c.owner.from("fuel_entries").update({ liters: 60, unit_price: 40 }).eq("id", f1.data!.id).select("id")).data?.length === 1 && Number((await svc.from("fuel_entries").select("total_amount").eq("id", f1.data!.id).single()).data?.total_amount) === 2400);
  check("sahip kaydı kendi diğer aracına taşıyabilir", (await c.owner.from("fuel_entries").update({ machine_id: mOwner2 }).eq("id", f2.data!.id).select("id")).data?.length === 1);
  bad("kayıt başka ortağın aracına taşınamaz (bileşik FK)", await c.owner.from("fuel_entries").update({ machine_id: mPartner }).eq("id", f2.data!.id));
  bad("güncellemede gelecek tarih reddedilir", await c.owner.from("fuel_entries").update({ fuel_date: tomorrow }).eq("id", f1.data!.id), "42501");
  bad("owner_id değiştirilemez (sütun yetkisi)", await c.owner.from("fuel_entries").update({ owner_id: ids.partner }).eq("id", f1.data!.id));
  bad("site_id değiştirilemez (sütun yetkisi)", await c.owner.from("fuel_entries").update({ site_id: siteB }).eq("id", f1.data!.id));
  bad("toplam tutar güncellenemez", await c.owner.from("fuel_entries").update({ total_amount: 1 }).eq("id", f1.data!.id));
  check("ortak, sahibin kaydını güncelleyemez", denied(await c.partner.from("fuel_entries").update({ liters: 1 }).eq("id", f1.data!.id).select("id")));
  for (const w of ["viewer", "admin", "outsider"] as Who[]) {
    check(`${w}: kayıt güncelleyemez`, denied(await c[w].from("fuel_entries").update({ liters: 1 }).eq("id", f1.data!.id).select("id")));
  }

  // ---------- özet RPC'si ----------
  // Şu an sahip: f1 = 60 L × 40 = 2400 (araç K1), f2 = 33,33 L × 41,99 = 1399,53 (araç K2), f3 = 100 L × 40 = 4000 (araç K2)
  const sum = await c.owner.rpc("get_fuel_summary", { p_site_id: siteA, p_owner: ids.owner, p_from: day(60), p_to: today });
  const rows = (sum.data ?? []) as { machine_id: number; entry_count: number; liters: string; total: string }[];
  const k2 = rows.find((r) => r.machine_id === mOwner2);
  check("özet araç bazında gruplar, en pahalı araç önce (K2 = 5399,53)", rows.length === 2 && rows[0].machine_id === mOwner2 && Number(rows[0].total) === 5399.53 && k2?.entry_count === 2 && Number(k2.liters) === 133.33, JSON.stringify(rows));
  check("özet toplamı kayıtların toplamıdır (7799,53)", Math.round(rows.reduce((s, r) => s + Number(r.total), 0) * 100) / 100 === 7799.53);
  const only = await c.owner.rpc("get_fuel_summary", { p_site_id: siteA, p_owner: ids.owner, p_from: day(60), p_to: today, p_machine: mOwner1 });
  check("araç süzgeci yalnızca o aracı döndürür (K1 = 2400)", (only.data ?? []).length === 1 && Number(only.data[0].total) === 2400);
  const narrow = await c.owner.rpc("get_fuel_summary", { p_site_id: siteA, p_owner: ids.owner, p_from: day(2), p_to: today });
  check("tarih aralığı süzgeci çalışır (son 2 gün: yalnızca f1 = 2400)", (narrow.data ?? []).length === 1 && Number(narrow.data[0].total) === 2400);
  check("ortak, sahibin özetini göremez (boş döner)", ((await c.partner.rpc("get_fuel_summary", { p_site_id: siteA, p_owner: ids.owner, p_from: day(60), p_to: today })).data ?? []).length === 0);
  check("admin sahibin özetini görür", ((await c.admin.rpc("get_fuel_summary", { p_site_id: siteA, p_owner: ids.owner, p_from: day(60), p_to: today })).data ?? []).length === 2);
  for (const w of ["viewer", "outsider", "owner2"] as Who[]) {
    check(`${w}: özet boş döner`, ((await c[w].rpc("get_fuel_summary", { p_site_id: siteA, p_owner: ids.owner, p_from: day(60), p_to: today })).data ?? []).length === 0);
  }
  const anonC = createClient(url, anon, { auth: { persistSession: false } });
  check("oturumsuz kullanıcı özeti çağıramaz", !!(await anonC.rpc("get_fuel_summary", { p_site_id: siteA, p_owner: ids.owner, p_from: day(60), p_to: today })).error);
  check("oturumsuz kullanıcı tabloyu okuyamaz", !!(await anonC.from("fuel_entries").select("id").limit(1)).error);

  // ---------- silme ----------
  bad("yakıt kaydı olan araç silinemez (maliyet geçmişi korunur)", await c.owner.from("machines").delete().eq("id", mOwner1), "23503");
  check("ortak, sahibin kaydını silemez", denied(await c.partner.from("fuel_entries").delete().eq("id", f1.data!.id).select("id")));
  for (const w of ["viewer", "admin", "outsider"] as Who[]) {
    check(`${w}: kayıt silemez`, denied(await c[w].from("fuel_entries").delete().eq("id", f1.data!.id).select("id")));
  }
  check("sahip kendi kaydını silebilir", (await c.owner.from("fuel_entries").delete().eq("id", f3.data!.id).select("id")).data?.length === 1);
  check("araç, yakıt kayıtları silindikten sonra silinebilir", (await c.owner.from("fuel_entries").delete().eq("id", f2.data!.id).select("id")).data?.length === 1 && (await c.owner.from("machines").delete().eq("id", mOwner2).select("id")).data?.length === 1);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftF = siteIds.length ? await svc.from("fuel_entries").select("id").in("site_id", siteIds) : { data: [] };
  const leftM = siteIds.length ? await svc.from("machines").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi (yakıt kayıtlı araçlı şantiye CASCADE ile silinir)", !delErr && !left.data?.length && !leftSites.data?.length && !leftF.data?.length && !leftM.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
