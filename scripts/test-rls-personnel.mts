/** RLS entegrasyon testi (Faz 4): personnel + payment_accounts + hassas veri (tc_no / iban) kısıtı.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:personnel  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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
  owner: { role: "partner" }, // A şantiyesinin sahibi
  partner: { role: "partner" }, // A şantiyesinin ortağı
  viewer: { role: "partner" }, // A şantiyesinin görüntüleyicisi
  outsider: { role: "partner" }, // hiçbir şantiyede değil
  owner2: { role: "partner" }, // B şantiyesinin sahibi
} as const;
type Who = keyof typeof accounts;
const cred = {} as Record<Who, { email: string; password: string }>;
const ids = {} as Record<Who, string>;
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);
const denied = (r: { error: unknown; data?: unknown }) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);

const TC = "12345678901";
const TC2 = "10000000146";
const IBAN = "TR330006100519786457841326";
const IBAN2 = "TR320010009999901234567890";

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
    const { data, error } = await svc.from("sites").insert({ name: `${name} ${tag}`, created_by: ids.owner }).select("id").single();
    if (error) throw error;
    siteIds.push(data.id);
    const { error: e2 } = await svc.from("site_members").insert(members.map(([w, role]) => ({ site_id: data.id, user_id: ids[w], role })));
    if (e2) throw e2;
    return data.id as number;
  };
  const siteA = await mkSite("A", [["owner", "owner"], ["partner", "partner"], ["viewer", "viewer"]]);
  const siteB = await mkSite("B", [["owner2", "owner"]]);

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  const { data: partyA } = await svc.from("parties").insert({ site_id: siteA, name: `Firma A ${tag}` }).select("id").single();
  const { data: partyB } = await svc.from("parties").insert({ site_id: siteB, name: `Firma B ${tag}` }).select("id").single();

  // ---------- personnel: ekleme ----------
  const ins = await c.partner.from("personnel").insert({ site_id: siteA, full_name: `Ali Veli ${tag}`, tc_no: TC, iban: IBAN, employer_party_id: partyA!.id, job: "Kalıpçı" }).select("id, full_name, has_tc_no, has_iban").single();
  check("ortak personel ekleyebilir (tc_no ve iban ile)", !ins.error, ins.error?.message);
  const pid = ins.data?.id as number;
  check("ekleme cevabında yalnızca 'dolu mu' bilgisi döner", ins.data?.has_tc_no === true && ins.data?.has_iban === true);

  check("viewer personel ekleyemez", !!(await c.viewer.from("personnel").insert({ site_id: siteA, full_name: `V ${tag}` })).error);
  check("üye olmayan personel ekleyemez", !!(await c.outsider.from("personnel").insert({ site_id: siteA, full_name: `X ${tag}` })).error);
  check("admin personel ekleyemez", !!(await c.admin.from("personnel").insert({ site_id: siteA, full_name: `Adm ${tag}` })).error);
  check("başka şantiyenin sahibi bu şantiyeye personel ekleyemez", !!(await c.owner2.from("personnel").insert({ site_id: siteA, full_name: `O2 ${tag}` })).error);

  // ---------- HASSAS VERİ: hiçbir rol tc_no / iban okuyamaz ----------
  for (const w of ["owner", "partner", "viewer", "admin"] as Who[]) {
    const a = await c[w].from("personnel").select("tc_no").eq("id", pid);
    check(`${w}: select('tc_no') reddedilir`, !!a.error, JSON.stringify(a.data));
    const b = await c[w].from("personnel").select("iban").eq("id", pid);
    check(`${w}: select('iban') reddedilir`, !!b.error, JSON.stringify(b.data));
    const all = await c[w].from("personnel").select("*").eq("id", pid);
    check(`${w}: select('*') hassas sütunlar yüzünden reddedilir (sızıntı yok)`, !!all.error && !JSON.stringify(all.data ?? "").includes(TC), JSON.stringify(all.data));
  }
  const filt = await c.owner.from("personnel").select("id").eq("tc_no", TC);
  check("tc_no ile filtreleyerek değer sorgulanamaz (tahmin saldırısı)", !!filt.error);
  const like = await c.viewer.from("personnel").select("id").like("iban", "TR33%");
  check("iban üzerinde LIKE ile sondaj yapılamaz", !!like.error);

  const okSel = await c.viewer.from("personnel").select("id, full_name, job, status, has_tc_no, has_iban").eq("id", pid);
  check("viewer hassas olmayan alanları ve 'dolu mu' bilgisini görebilir", okSel.data?.length === 1 && okSel.data[0].has_tc_no === true);
  check("admin hassas olmayan alanları görüntüleyebilir", (await c.admin.from("personnel").select("id, full_name").eq("id", pid)).data?.length === 1);
  check("üye olmayan personeli göremez", (await c.outsider.from("personnel").select("id").eq("site_id", siteA)).data?.length === 0);
  check("başka şantiyenin sahibi personeli göremez", (await c.owner2.from("personnel").select("id").eq("site_id", siteA)).data?.length === 0);

  // ---------- RPC: değeri aç ----------
  const revOwner = await c.owner.rpc("reveal_personnel_sensitive", { p_personnel_id: pid });
  const row = (revOwner.data as { tc_no: string; iban: string }[] | null)?.[0];
  check("owner 'Göster' ile gerçek değerleri alır", row?.tc_no === TC && row?.iban === IBAN, JSON.stringify(revOwner));
  check("ortak (partner) 'Göster' ile alır", ((await c.partner.rpc("reveal_personnel_sensitive", { p_personnel_id: pid })).data as unknown[] | null)?.length === 1);
  check("admin 'Göster' ile alır", ((await c.admin.rpc("reveal_personnel_sensitive", { p_personnel_id: pid })).data as unknown[] | null)?.length === 1);
  check("viewer 'Göster' ile alamaz", !!(await c.viewer.rpc("reveal_personnel_sensitive", { p_personnel_id: pid })).error);
  check("üye olmayan alamaz", !!(await c.outsider.rpc("reveal_personnel_sensitive", { p_personnel_id: pid })).error);
  check("başka şantiyenin sahibi alamaz", !!(await c.owner2.rpc("reveal_personnel_sensitive", { p_personnel_id: pid })).error);
  check("anonim alamaz", !!(await createClient(url, anon).rpc("reveal_personnel_sensitive", { p_personnel_id: pid })).error);
  check("olmayan kayıt için hata döner", !!(await c.owner.rpc("reveal_personnel_sensitive", { p_personnel_id: 999999999 })).error);

  // ---------- erişim günlüğü ----------
  const logAdmin = await c.admin.from("sensitive_access_log").select("user_id, table_name, record_id, site_id").eq("record_id", pid);
  const ids3 = new Set((logAdmin.data ?? []).map((l) => l.user_id));
  check("her başarılı erişim günlüğe yazıldı (owner, partner, admin)", (logAdmin.data?.length ?? 0) === 3 && ids3.has(ids.owner) && ids3.has(ids.partner) && ids3.has(ids.admin), JSON.stringify(logAdmin.data));
  check("reddedilen erişimler günlüğe yazılmadı", (logAdmin.data?.length ?? 0) === 3);
  check("ortak günlüğü okuyamaz", (await c.owner.from("sensitive_access_log").select("id")).data?.length === 0);
  check("ortak günlüğe yazamaz", !!(await c.owner.from("sensitive_access_log").insert({ table_name: "x", record_id: 1 })).error);
  check("ortak günlüğü silemez/değiştiremez", denied(await c.owner.from("sensitive_access_log").delete().eq("record_id", pid).select("id")));

  // ---------- doğrulama kısıtları ----------
  check("geçersiz TC (kısa) reddedilir", !!(await c.owner.from("personnel").insert({ site_id: siteA, full_name: `T1 ${tag}`, tc_no: "123" })).error);
  check("0 ile başlayan TC reddedilir", !!(await c.owner.from("personnel").insert({ site_id: siteA, full_name: `T2 ${tag}`, tc_no: "01234567890" })).error);
  check("aynı şantiyede aynı TC ikinci kez eklenemez", !!(await c.owner.from("personnel").insert({ site_id: siteA, full_name: `Dup ${tag}`, tc_no: TC })).error);
  const otherSiteSameTc = await c.owner2.from("personnel").insert({ site_id: siteB, full_name: `B ${tag}`, tc_no: TC }).select("id").single();
  check("aynı TC başka şantiyede eklenebilir (şantiyeler bağımsız)", !otherSiteSameTc.error, otherSiteSameTc.error?.message);
  check("geçersiz IBAN reddedilir", !!(await c.owner.from("personnel").insert({ site_id: siteA, full_name: `I ${tag}`, iban: "abc" })).error);
  check("geçersiz durum reddedilir", !!(await c.owner.from("personnel").insert({ site_id: siteA, full_name: `S ${tag}`, status: "uyuyor" })).error);
  check("çıkış tarihi işe giriş tarihinden önce olamaz", !!(await c.owner.from("personnel").insert({ site_id: siteA, full_name: `D ${tag}`, hire_date: "2026-05-01", termination_date: "2026-04-01" })).error);
  check("negatif gün sayısı reddedilir", !!(await c.owner.from("personnel").insert({ site_id: siteA, full_name: `N ${tag}`, absence_days_count: -2 })).error);
  check("başka şantiyenin firması çalıştığı firma olarak bağlanamaz (bileşik FK)", !!(await c.owner.from("personnel").insert({ site_id: siteA, full_name: `F ${tag}`, employer_party_id: partyB!.id })).error);

  // ---------- güncelleme / silme ----------
  const upd = await c.owner.from("personnel").update({ job: "Ustabaşı", status: "izinli" }).eq("id", pid).select("job, status");
  check("üye (owner) personeli güncelleyebilir", upd.data?.[0]?.job === "Ustabaşı" && upd.data?.[0]?.status === "izinli");
  const updTc = await c.partner.from("personnel").update({ tc_no: TC2, iban: IBAN2 }).eq("id", pid).select("has_tc_no");
  check("yazma yetkilisi tc_no/iban değiştirebilir", !updTc.error && updTc.data?.length === 1, updTc.error?.message);
  const rev2 = (await c.owner.rpc("reveal_personnel_sensitive", { p_personnel_id: pid })).data as { tc_no: string; iban: string }[] | null;
  check("değişiklik doğru yazıldı (Göster ile doğrulandı)", rev2?.[0]?.tc_no === TC2 && rev2?.[0]?.iban === IBAN2);
  const clr = await c.owner.from("personnel").update({ iban: null }).eq("id", pid).select("has_iban");
  check("IBAN temizlenebilir (has_iban=false)", clr.data?.[0]?.has_iban === false);
  check("viewer güncelleyemez", denied(await c.viewer.from("personnel").update({ job: "x" }).eq("id", pid).select("id")));
  check("admin güncelleyemez", denied(await c.admin.from("personnel").update({ job: "x" }).eq("id", pid).select("id")));
  check("üye olmayan güncelleyemez", denied(await c.outsider.from("personnel").update({ job: "x" }).eq("id", pid).select("id")));
  check("personelin site_id'si değiştirilemez", !!(await c.owner.from("personnel").update({ site_id: siteB }).eq("id", pid)).error);
  check("personele başka şantiyenin firması bağlanamaz (güncellemede)", !!(await c.owner.from("personnel").update({ employer_party_id: partyB!.id }).eq("id", pid)).error);

  check("ortak (partner) personel silemez, yalnızca sahip", denied(await c.partner.from("personnel").delete().eq("id", pid).select("id")));
  check("viewer silemez", denied(await c.viewer.from("personnel").delete().eq("id", pid).select("id")));
  check("admin silemez", denied(await c.admin.from("personnel").delete().eq("id", pid).select("id")));

  // ---------- payment_accounts ----------
  const pa = await c.partner.from("payment_accounts").insert({ site_id: siteA, full_name: `Usta ${tag}`, iban: IBAN, profession: "Sıvacı", personnel_id: pid, party_id: partyA!.id }).select("id").single();
  check("ortak ödeme hesabı ekleyebilir", !pa.error, pa.error?.message);
  const paId = pa.data?.id as number;
  check("viewer ödeme hesabı ekleyemez", !!(await c.viewer.from("payment_accounts").insert({ site_id: siteA, full_name: `V ${tag}`, iban: IBAN })).error);
  check("admin ödeme hesabı ekleyemez", !!(await c.admin.from("payment_accounts").insert({ site_id: siteA, full_name: `A ${tag}`, iban: IBAN })).error);
  for (const w of ["owner", "viewer", "admin"] as Who[]) {
    check(`${w}: payment_accounts.iban okunamaz`, !!(await c[w].from("payment_accounts").select("iban").eq("id", paId)).error);
    check(`${w}: payment_accounts select('*') reddedilir`, !!(await c[w].from("payment_accounts").select("*").eq("id", paId)).error);
  }
  check("viewer ödeme hesabının hassas olmayan alanlarını görür", (await c.viewer.from("payment_accounts").select("id, full_name, profession").eq("id", paId)).data?.length === 1);
  check("owner ödeme IBAN'ını 'Göster' ile alır", (await c.owner.rpc("reveal_payment_iban", { p_account_id: paId })).data === IBAN);
  check("admin ödeme IBAN'ını alır", (await c.admin.rpc("reveal_payment_iban", { p_account_id: paId })).data === IBAN);
  check("viewer ödeme IBAN'ını alamaz", !!(await c.viewer.rpc("reveal_payment_iban", { p_account_id: paId })).error);
  check("başka şantiyenin sahibi ödeme IBAN'ını alamaz", !!(await c.owner2.rpc("reveal_payment_iban", { p_account_id: paId })).error);
  check("geçersiz IBAN reddedilir (ödeme hesabı)", !!(await c.owner.from("payment_accounts").insert({ site_id: siteA, full_name: `G ${tag}`, iban: "12" })).error);
  const { data: persB } = await svc.from("personnel").insert({ site_id: siteB, full_name: `PB ${tag}` }).select("id").single();
  check("başka şantiyenin personeli ödeme hesabına bağlanamaz (bileşik FK)", !!(await c.owner.from("payment_accounts").insert({ site_id: siteA, full_name: `C ${tag}`, iban: IBAN, personnel_id: persB!.id })).error);
  check("başka şantiyenin firması ödeme hesabına bağlanamaz (bileşik FK)", !!(await c.owner.from("payment_accounts").insert({ site_id: siteA, full_name: `C2 ${tag}`, iban: IBAN, party_id: partyB!.id })).error);
  check("ödeme hesabını silmek yazma yetkilisine açık", (await c.partner.from("payment_accounts").delete().eq("id", paId).select("id")).data?.length === 1);

  check("sahip personeli silebilir", (await c.owner.from("personnel").delete().eq("id", pid).select("id")).data?.length === 1);

  const an = createClient(url, anon);
  check("anonim personel okuyamaz", denied(await an.from("personnel").select("id")));
  check("anonim ödeme hesabı okuyamaz", denied(await an.from("payment_accounts").select("id")));
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  if (siteIds.length) await svc.from("sites").delete().in("id", siteIds); // personnel/payment_accounts/parties CASCADE
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  await svc.from("sensitive_access_log").delete().in("site_id", siteIds);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftPeople = await svc.from("personnel").select("id").like("full_name", `%${tag}`);
  check("test verisi temizlendi", !left.data?.length && !leftSites.data?.length && !leftPeople.data?.length);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
