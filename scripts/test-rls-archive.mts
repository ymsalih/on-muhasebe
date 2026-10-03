/** RLS/bütünlük testi: şantiye düzenleme/arşiv/silme, üye çıkarma/arşiv, ortak hesabı arşivi ve veri sayaçları.
 *  Kural: verisi olmayan silinir, verisi olan silinemez (arşive alınır); arşivdeki şantiye/üye/hesap salt okunurdur.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:archive  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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
  partner: { role: "partner" }, // verisi olan üye
  clean: { role: "partner" }, // verisi olmayan üye
  viewer: { role: "partner" },
  outsider: { role: "partner" },
} as const;
type Who = keyof typeof accounts;
const cred = {} as Record<Who, { email: string; password: string }>;
const ids = {} as Record<Who, string>;
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const day = (n: number) => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
const code = (r: { error: { code?: string } | null }) => r.error?.code;

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
    if (members.length) await svc.from("site_members").insert(members.map(([w, role]) => ({ site_id: data!.id, user_id: ids[w], role })));
    return data!.id as number;
  };
  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  // ======================= ŞANTİYE: düzenleme =======================
  const sMain = await mkSite("Ana", [["owner", "owner"], ["partner", "partner"], ["clean", "partner"], ["viewer", "viewer"]]);
  check("sahip şantiye bilgilerini düzenler", !(await c.owner.rpc("update_site_details", { p_site_id: sMain, p_name: `Ana Yeni ${tag}`, p_address: "Ankara", p_start_date: day(10) })).error);
  const row = (await svc.from("sites").select("name, address, start_date").eq("id", sMain).single()).data;
  check("düzenleme kaydedildi (ad, adres, tarih)", row?.name === `Ana Yeni ${tag}` && row?.address === "Ankara" && row?.start_date === day(10), JSON.stringify(row));
  check("admin şantiye bilgilerini düzenler", !(await c.admin.rpc("update_site_details", { p_site_id: sMain, p_name: `Ana Admin ${tag}`, p_address: null, p_start_date: null })).error);
  check("adres/tarih boş bırakılabilir", (await svc.from("sites").select("address, start_date").eq("id", sMain).single()).data?.address === null);
  for (const w of ["partner", "viewer", "outsider"] as Who[]) {
    check(`${w}: şantiyeyi düzenleyemez`, code(await c[w].rpc("update_site_details", { p_site_id: sMain, p_name: "Hack", p_address: null, p_start_date: null })) === "42501");
  }
  check("kısa ad reddedilir", code(await c.owner.rpc("update_site_details", { p_site_id: sMain, p_name: "x", p_address: null, p_start_date: null })) === "23514");
  check("olmayan şantiye: bulunamadı", code(await c.admin.rpc("update_site_details", { p_site_id: 999999999, p_name: "Yok yok", p_address: null, p_start_date: null })) === "P0002");

  // ======================= ŞANTİYE: veri özeti =======================
  check("sahip veri özetini görür (boş: 0)", (await c.owner.rpc("get_site_data_summary", { p_site_id: sMain })).data?.total === 0);
  check("admin veri özetini görür", !(await c.admin.rpc("get_site_data_summary", { p_site_id: sMain })).error);
  for (const w of ["partner", "viewer", "outsider"] as Who[]) {
    check(`${w}: veri özetini göremez`, code(await c[w].rpc("get_site_data_summary", { p_site_id: sMain })) === "42501");
  }
  const mp = await svc.from("machines").insert({ site_id: sMain, owner_id: ids.partner, name: `Ortak Kamyonu ${tag}`, machine_type: "kamyon", identifier: "P1", ownership: "own" }).select("id").single();
  const sum1 = (await c.owner.rpc("get_site_data_summary", { p_site_id: sMain })).data;
  check("sahip, ortağın ÖZEL verisini de sayar (makine = 1)", sum1?.total === 1 && sum1?.counts?.machines === 1, JSON.stringify(sum1));
  const memTotals = ((await c.owner.rpc("get_member_data_totals", { p_site_id: sMain })).data ?? []) as { user_id: string; total: number }[];
  check("üye başına veri: ortak 1, temiz ortak 0", memTotals.find((m) => m.user_id === ids.partner)?.total === 1 && memTotals.find((m) => m.user_id === ids.clean)?.total === 0, JSON.stringify(memTotals));
  check("viewer/ortak üye veri toplamlarını göremez", code(await c.partner.rpc("get_member_data_totals", { p_site_id: sMain })) === "42501");

  // ======================= ŞANTİYE: silme =======================
  check("verisi olan şantiye silinemez (sahip) → 55000", code(await c.owner.rpc("delete_site", { p_site_id: sMain })) === "55000");
  check("verisi olan şantiye silinemez (admin) → 55000", code(await c.admin.rpc("delete_site", { p_site_id: sMain })) === "55000");
  check("reddedilen silme şantiyeyi bozmaz", (await svc.from("sites").select("id").eq("id", sMain)).data?.length === 1 && (await svc.from("machines").select("id").eq("site_id", sMain)).data?.length === 1);
  const sEmptyA = await mkSite("BosA", [["owner", "owner"], ["clean", "partner"]]);
  for (const w of ["partner", "viewer", "outsider", "clean"] as Who[]) {
    check(`${w}: boş şantiyeyi silemez`, code(await c[w].rpc("delete_site", { p_site_id: sEmptyA })) === "42501");
  }
  check("sahip, VERİSİ OLMAYAN şantiyeyi siler (üyelikler CASCADE)", !(await c.owner.rpc("delete_site", { p_site_id: sEmptyA })).error && (await svc.from("sites").select("id").eq("id", sEmptyA)).data?.length === 0 && (await svc.from("site_members").select("id").eq("site_id", sEmptyA)).data?.length === 0);
  const sEmptyB = await mkSite("BosB", [["owner", "owner"]]);
  check("admin, VERİSİ OLMAYAN şantiyeyi siler", !(await c.admin.rpc("delete_site", { p_site_id: sEmptyB })).error && (await svc.from("sites").select("id").eq("id", sEmptyB)).data?.length === 0);
  check("olmayan şantiye silinemez → bulunamadı", code(await c.admin.rpc("delete_site", { p_site_id: sEmptyB })) === "P0002");
  const sOnlyPartnerData = await mkSite("SadeceOrtakVeri", [["owner", "owner"], ["partner", "partner"]]);
  await svc.from("fuel_entries").insert({ site_id: sOnlyPartnerData, owner_id: ids.partner, machine_id: (await svc.from("machines").insert({ site_id: sOnlyPartnerData, owner_id: ids.partner, name: `X ${tag}`, machine_type: "kamyon", identifier: "X", ownership: "own" }).select("id").single()).data!.id, fuel_date: day(1), liters: 10, unit_price: 40 });
  check("sahibin göremediği ortak verisi de silmeyi engeller (özel veri korunur)", code(await c.owner.rpc("delete_site", { p_site_id: sOnlyPartnerData })) === "55000");
  check("oturumsuz kullanıcı silme/düzenleme çağıramaz", !!(await createClient(url, anon, { auth: { persistSession: false } }).rpc("delete_site", { p_site_id: sMain })).error);

  // ======================= ŞANTİYE: arşiv (salt okunur) =======================
  const party = (site: number, name: string) => ({ site_id: site, name: `${name} ${tag}`, category: "firma" });
  await svc.from("parties").insert(party(sMain, "Mevcut Cari"));
  check("arşivden ÖNCE: ortak veri yazabilir", !(await c.partner.from("parties").insert(party(sMain, "Önce"))).error);
  check("ortak şantiyeyi arşive alamaz", code(await c.partner.rpc("set_site_archived", { p_site_id: sMain, p_archived: true })) === "42501");
  check("viewer/dışarıdan biri arşive alamaz", code(await c.viewer.rpc("set_site_archived", { p_site_id: sMain, p_archived: true })) === "42501" && code(await c.outsider.rpc("set_site_archived", { p_site_id: sMain, p_archived: true })) === "42501");
  check("sahip şantiyeyi arşive alır", !(await c.owner.rpc("set_site_archived", { p_site_id: sMain, p_archived: true })).error && (await svc.from("sites").select("status").eq("id", sMain).single()).data?.status === "archived");
  const ins = async (who: Who, table: string, rowv: Record<string, unknown>) => !!(await c[who].from(table).insert(rowv)).error;
  check("ARŞİVDE: sahip veri yazamaz (cari)", await ins("owner", "parties", party(sMain, "Arşiv1")));
  check("ARŞİVDE: ortak veri yazamaz (cari)", await ins("partner", "parties", party(sMain, "Arşiv2")));
  check("ARŞİVDE: ortak kasa hareketi yazamaz", await ins("partner", "transactions", { site_id: sMain, user_id: ids.partner, type: "expense", description: "x", amount: 10, transaction_date: day(1) }));
  check("ARŞİVDE: ortak kendi makinesine yakıt yazamaz", await ins("partner", "fuel_entries", { site_id: sMain, owner_id: ids.partner, machine_id: mp.data!.id, fuel_date: day(1), liters: 5, unit_price: 40 }));
  check("ARŞİVDE: ortak yeni makine ekleyemez", await ins("partner", "machines", { site_id: sMain, owner_id: ids.partner, name: `Y ${tag}`, machine_type: "kamyon", identifier: "Y", ownership: "own" }));
  check("ARŞİVDE: ortak malzeme girişi yazamaz", await ins("partner", "material_entries", { site_id: sMain, entry_date: day(1), name: "m", unit: "adet", quantity: 1, unit_price: 1, created_by: ids.partner }));
  check("ARŞİVDE: mevcut kayıt güncellenemez", ((await c.owner.from("parties").update({ phone: "1" }).eq("site_id", sMain).select("id")).data ?? []).length === 0);
  check("ARŞİVDE: mevcut kayıt silinemez", ((await c.owner.from("parties").delete().eq("site_id", sMain).select("id")).data ?? []).length === 0);
  check("ARŞİVDE: veriler okunabilir (sahip ve ortak)", ((await c.owner.from("parties").select("id").eq("site_id", sMain)).data ?? []).length >= 2 && ((await c.partner.from("machines").select("id").eq("site_id", sMain)).data ?? []).length === 1);
  check("ARŞİVDE: admin yine salt okur", ((await c.admin.from("parties").select("id").eq("site_id", sMain)).data ?? []).length >= 2);
  check("ARŞİVDE: şantiye dışındaki kişi yine hiçbir şey göremez", ((await c.outsider.from("parties").select("id").eq("site_id", sMain)).data ?? []).length === 0);
  check("ARŞİVDE: silme hâlâ engelli", code(await c.owner.rpc("delete_site", { p_site_id: sMain })) === "55000");
  check("arşivdeki şantiyede sahip bilgileri düzenleyebilir", !(await c.owner.rpc("update_site_details", { p_site_id: sMain, p_name: `Ana Arşiv ${tag}`, p_address: null, p_start_date: null })).error);
  check("sahip şantiyeyi arşivden çıkarır → yazma geri gelir", !(await c.owner.rpc("set_site_archived", { p_site_id: sMain, p_archived: false })).error && !(await c.partner.from("parties").insert(party(sMain, "Sonra"))).error);
  check("admin de arşive alabilir ve geri alabilir", !(await c.admin.rpc("set_site_archived", { p_site_id: sMain, p_archived: true })).error && !(await c.admin.rpc("set_site_archived", { p_site_id: sMain, p_archived: false })).error);

  // ======================= ÜYE: çıkar / arşiv =======================
  const members = ((await svc.from("site_members").select("id, user_id, role").eq("site_id", sMain)).data ?? []) as { id: number; user_id: string; role: string }[];
  const mem = (w: Who) => members.find((m) => m.user_id === ids[w])!.id;
  check("ortak, başka üyeyi çıkaramaz", code(await c.partner.rpc("remove_site_member", { p_site_id: sMain, p_member_id: mem("clean") })) === "42501");
  check("sahip çıkarılamaz", code(await c.owner.rpc("remove_site_member", { p_site_id: sMain, p_member_id: mem("owner") })) === "42501");
  check("VERİSİ OLAN üye çıkarılamaz → 55000", code(await c.owner.rpc("remove_site_member", { p_site_id: sMain, p_member_id: mem("partner") })) === "55000");
  const direct = await c.owner.from("site_members").delete().eq("id", mem("partner")).select("id");
  check("VERİSİ OLAN üye doğrudan da silinemez (RLS)", (direct.data ?? []).length === 0 && (await svc.from("site_members").select("id").eq("id", mem("partner"))).data?.length === 1);
  check("verisi olmayan üye çıkarılır", !(await c.owner.rpc("remove_site_member", { p_site_id: sMain, p_member_id: mem("clean") })).error && (await svc.from("site_members").select("id").eq("id", mem("clean"))).data?.length === 0);
  check("çıkarılan üye artık şantiyeyi göremez", ((await c.clean.from("sites").select("id").eq("id", sMain)).data ?? []).length === 0);
  check("ortak üyeyi arşive alamaz", code(await c.partner.rpc("set_member_archived", { p_site_id: sMain, p_member_id: mem("viewer"), p_archived: true })) === "42501");
  check("sahip arşive alınamaz", code(await c.owner.rpc("set_member_archived", { p_site_id: sMain, p_member_id: mem("owner"), p_archived: true })) === "42501");
  check("sahip, verisi olan üyeyi arşive alır", !(await c.owner.rpc("set_member_archived", { p_site_id: sMain, p_member_id: mem("partner"), p_archived: true })).error);
  check("ARŞİVDEKİ ÜYE: kendi verisini görür", ((await c.partner.from("machines").select("id").eq("site_id", sMain)).data ?? []).length === 1);
  check("ARŞİVDEKİ ÜYE: veri yazamaz", await ins("partner", "parties", party(sMain, "ArşivÜye")) && await ins("partner", "fuel_entries", { site_id: sMain, owner_id: ids.partner, machine_id: mp.data!.id, fuel_date: day(1), liters: 5, unit_price: 40 }));
  check("ARŞİVDEKİ ÜYE: kendi kaydını değiştiremez/silemez", ((await c.partner.from("machines").update({ supplier: "x" }).eq("id", mp.data!.id).select("id")).data ?? []).length === 0 && ((await c.partner.from("machines").delete().eq("id", mp.data!.id).select("id")).data ?? []).length === 0);
  check("arşivdeki üye diğer üyeler için etkisizdir (sahip yazmaya devam eder)", !(await c.owner.from("parties").insert(party(sMain, "SahipDevam"))).error);
  check("arşivdeki üye doğrudan geri alınamaz (sütun yetkisi yok)", ((await c.partner.from("site_members").update({ archived_at: null }).eq("id", mem("partner")).select("id")).data ?? []).length === 0);
  check("sahip üyeyi geri alır → yazma geri gelir", !(await c.owner.rpc("set_member_archived", { p_site_id: sMain, p_member_id: mem("partner"), p_archived: false })).error && !(await c.partner.from("parties").insert(party(sMain, "Geri"))).error);

  // ======================= HESAP: arşiv (service_role) =======================
  const us = (await c.admin.rpc("get_user_data_summary", { p_user_id: ids.partner })).data;
  check("admin ortağın TÜM şantiyelerdeki veri özetini görür (2 makine, 1 yakıt, 2 üyelik, toplam 3)", us?.counts?.machines === 2 && us?.counts?.fuel_entries === 1 && us?.total === 3 && us?.member_sites === 2 && us?.owned_sites === 0, JSON.stringify(us));
  check("sahibin özeti: şantiye sahibi sayısı", (await c.admin.rpc("get_user_data_summary", { p_user_id: ids.owner })).data?.owned_sites >= 1);
  check("temiz ortağın verisi yok (silinebilir)", (await c.admin.rpc("get_user_data_summary", { p_user_id: ids.clean })).data?.total === 0);
  for (const w of ["owner", "partner", "outsider"] as Who[]) {
    check(`${w}: kullanıcı veri özetini göremez`, code(await c[w].rpc("get_user_data_summary", { p_user_id: ids.partner })) === "42501");
  }
  check("ortak kendi hesabını arşive ALAMAZ (sütun yetkisi yok)", !!(await c.partner.from("users").update({ archived_at: new Date().toISOString() }).eq("id", ids.partner)).error);
  check("owner başkasını arşive ALAMAZ", ((await c.owner.from("users").update({ archived_at: new Date().toISOString() }).eq("id", ids.partner).select("id")).data ?? []).length === 0 && !!(await c.owner.from("users").update({ archived_at: new Date().toISOString() }).eq("id", ids.partner)).error);
  await svc.from("users").update({ archived_at: new Date().toISOString() }).eq("id", ids.partner);
  check("ARŞİVDEKİ HESAP: geçerli oturumla bile hiçbir şantiye göremez", ((await c.partner.from("sites").select("id")).data ?? []).length === 0);
  check("ARŞİVDEKİ HESAP: kendi verisini göremez/yazamaz", ((await c.partner.from("machines").select("id").eq("site_id", sMain)).data ?? []).length === 0 && await ins("partner", "parties", party(sMain, "Pasif")));
  check("arşivdeki hesap şantiyeye eklenmek üzere aranamaz", (((await c.owner.rpc("search_users_for_site", { p_site_id: sOnlyPartnerData, p_query: `T partner ${tag}` })).data ?? []) as unknown[]).length === 0);
  check("arşivdeki ortak yok sayılınca diğerleri etkilenmez (sahip yazar)", !(await c.owner.from("parties").insert(party(sMain, "SahipHâlâ"))).error);
  check("admin arşivdeki ortağın verisini yine görür (salt okuma)", ((await c.admin.from("machines").select("id").eq("site_id", sMain)).data ?? []).length === 1);
  await svc.from("users").update({ archived_at: null }).eq("id", ids.partner);
  check("GERİ ALINAN HESAP: şantiyeleri ve yazma yetkisi döner", ((await c.partner.from("sites").select("id").eq("id", sMain)).data ?? []).length === 1 && !(await c.partner.from("parties").insert(party(sMain, "Aktif"))).error);
  check("arama: aktif ortak bulunur (arşiv süzgeci yalnızca pasifleri eler)", (((await c.owner.rpc("search_users_for_site", { p_site_id: sOnlyPartnerData, p_query: `T outsider ${tag}` })).data ?? []) as unknown[]).length === 1);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).stack ?? e).slice(0, 700));
} finally {
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  check("test verisi temizlendi", !delErr && !left.data?.length && !leftSites.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
