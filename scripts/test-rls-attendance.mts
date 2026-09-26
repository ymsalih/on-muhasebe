/** RLS entegrasyon testi (Faz 5): attendance, monthly_attendance_summary ve set_attendance RPC.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:attendance  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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

const istanbulDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
};
const today = istanbulDate(0);
const yesterday = istanbulDate(-1);
const tomorrow = istanbulDate(1);
const lastMonthDay = istanbulDate(-40);
const monthOf = (iso: string) => iso.slice(0, 7) + "-01";

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

  const { data: people } = await svc.from("personnel").insert([
    { site_id: siteA, full_name: `A1 ${tag}` },
    { site_id: siteA, full_name: `A2 ${tag}` },
    { site_id: siteA, full_name: `A3 ${tag}` },
    { site_id: siteB, full_name: `B1 ${tag}` },
  ]).select("id, full_name");
  const pid = (n: string) => people!.find((p) => p.full_name.startsWith(n))!.id as number;
  const [a1, a2, a3, b1] = [pid("A1"), pid("A2"), pid("A3"), pid("B1")];

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  const att = async (date: string) => ((await svc.from("attendance").select("personnel_id, recorded_by").eq("site_id", siteA).eq("work_date", date)).data ?? []);

  // ---------- set_attendance: yetkili ----------
  const r1 = await c.partner.rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: [a1, a2], p_remove: [] });
  check("ortak (partner) bugünün puantajını kaydedebilir", !r1.error, r1.error?.message);
  let rows = await att(today);
  check("iki kişi işaretlendi", rows.length === 2);
  check("recorded_by = işaretleyen kullanıcı (istemciden sahtelenemez)", rows.every((r) => r.recorded_by === ids.partner));

  const r2 = await c.partner.rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: [a1, a2], p_remove: [] });
  check("aynı kişileri tekrar eklemek hata vermez (idempotent)", !r2.error, r2.error?.message);
  check("tekrar eklemede kayıt çoğalmadı", (await att(today)).length === 2);

  const r3 = await c.owner.rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: [a3], p_remove: [] });
  check("owner, ortağın işaretlerine dokunmadan ekleme yapar", !r3.error && (await att(today)).length === 3, r3.error?.message);
  const r4 = await c.owner.rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: [], p_remove: [a2] });
  rows = await att(today);
  check("çıkarma yalnızca istenen kişiyi siler", !r4.error && rows.length === 2 && !rows.some((r) => r.personnel_id === a2), JSON.stringify(rows));
  check("çıkarılmayanların recorded_by'ı korunur", rows.find((r) => r.personnel_id === a1)?.recorded_by === ids.partner);
  const r5 = await c.owner.rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: [a2], p_remove: [a2] });
  check("aynı kişi hem ekle hem çıkar listesindeyse sonuçta işaretli (önce sil sonra ekle)", !r5.error && (await att(today)).some((r) => r.personnel_id === a2));

  check("geçmiş bir güne puantaj girilebilir", !(await c.partner.rpc("set_attendance", { p_site_id: siteA, p_work_date: yesterday, p_add: [a1], p_remove: [] })).error);
  check("geçen aya puantaj girilebilir (aylık özet için)", !(await c.partner.rpc("set_attendance", { p_site_id: siteA, p_work_date: lastMonthDay, p_add: [a1, a3], p_remove: [] })).error);

  // ---------- set_attendance: yetkisizler ----------
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    const r = await c[w].rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: [a3], p_remove: [] });
    check(`${w}: set_attendance reddedilir`, !!r.error, JSON.stringify(r.error));
    const rr = await c[w].rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: [], p_remove: [a1] });
    check(`${w}: puantaj silme (RPC) reddedilir`, !!rr.error);
  }
  check("anonim set_attendance çağıramaz", !!(await createClient(url, anon).rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: [a1], p_remove: [] })).error);
  check("yetkisizlerin denemeleri veriyi değiştirmedi", (await att(today)).length === 3);

  // ---------- kurallar ----------
  const fut = await c.partner.rpc("set_attendance", { p_site_id: siteA, p_work_date: tomorrow, p_add: [a1], p_remove: [] });
  check("yarının tarihine puantaj girilemez (RPC)", !!fut.error, fut.error?.message);
  check("yarının tarihine doğrudan insert edilemez (RLS)", !!(await c.partner.from("attendance").insert({ site_id: siteA, personnel_id: a1, work_date: tomorrow, recorded_by: ids.partner })).error);
  check("başka şantiyenin personeli bu şantiyeye işlenemez (bileşik FK)", !!(await c.owner.rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: [b1], p_remove: [] })).error);
  check("başka şantiyenin personeli doğrudan insert ile de işlenemez", !!(await c.owner.from("attendance").insert({ site_id: siteA, personnel_id: b1, work_date: today, recorded_by: ids.owner })).error);
  check("aynı kişi aynı gün doğrudan iki kez eklenemez (UNIQUE)", !!(await c.owner.from("attendance").insert({ site_id: siteA, personnel_id: a1, work_date: today, recorded_by: ids.owner })).error);
  check("başkası adına (recorded_by) doğrudan insert edilemez", !!(await c.owner.from("attendance").insert({ site_id: siteA, personnel_id: a2, work_date: yesterday, recorded_by: ids.partner })).error);
  check("viewer doğrudan insert edemez", !!(await c.viewer.from("attendance").insert({ site_id: siteA, personnel_id: a2, work_date: yesterday, recorded_by: ids.viewer })).error);
  check("admin doğrudan insert edemez", !!(await c.admin.from("attendance").insert({ site_id: siteA, personnel_id: a2, work_date: yesterday, recorded_by: ids.admin })).error);
  check("1000'den fazla kişi tek seferde işlenemez", !!(await c.partner.rpc("set_attendance", { p_site_id: siteA, p_work_date: today, p_add: Array.from({ length: 1001 }, (_, i) => i + 1), p_remove: [] })).error);

  // ---------- okuma ----------
  check("viewer puantajı görebilir", (await c.viewer.from("attendance").select("id").eq("site_id", siteA).eq("work_date", today)).data?.length === 3);
  check("admin puantajı görüntüleyebilir", (await c.admin.from("attendance").select("id").eq("site_id", siteA).eq("work_date", today)).data?.length === 3);
  check("üye olmayan puantajı göremez", (await c.outsider.from("attendance").select("id").eq("site_id", siteA)).data?.length === 0);
  check("başka şantiyenin sahibi puantajı göremez", (await c.owner2.from("attendance").select("id").eq("site_id", siteA)).data?.length === 0);

  // ---------- güncelleme / silme ----------
  const attRow = (await svc.from("attendance").select("id").eq("site_id", siteA).eq("personnel_id", a1).eq("work_date", today).single()).data!;
  check("yazma yetkilisi not ekleyebilir", (await c.owner.from("attendance").update({ note: "yarım gün" }).eq("id", attRow.id).select("id")).data?.length === 1);
  check("işaretlenen gün değiştirilemez (yalnızca not güncellenebilir)", !!(await c.owner.from("attendance").update({ work_date: yesterday }).eq("id", attRow.id)).error);
  check("işaretlenen personel değiştirilemez", !!(await c.owner.from("attendance").update({ personnel_id: a2 }).eq("id", attRow.id)).error);
  check("viewer not güncelleyemez", denied(await c.viewer.from("attendance").update({ note: "x" }).eq("id", attRow.id).select("id")));
  check("admin not güncelleyemez", denied(await c.admin.from("attendance").update({ note: "x" }).eq("id", attRow.id).select("id")));
  check("viewer doğrudan silemez", denied(await c.viewer.from("attendance").delete().eq("id", attRow.id).select("id")));
  check("admin doğrudan silemez", denied(await c.admin.from("attendance").delete().eq("id", attRow.id).select("id")));
  check("üye olmayan doğrudan silemez", denied(await c.outsider.from("attendance").delete().eq("id", attRow.id).select("id")));

  // ---------- aylık özet view'i ----------
  const thisMonth = monthOf(today);
  const view = await c.viewer.from("monthly_attendance_summary").select("personnel_id, month, days_worked").eq("site_id", siteA);
  const days = (p: number, m: string) => view.data?.find((r) => r.personnel_id === p && r.month === m)?.days_worked;
  const expectedA1 = new Set([today, yesterday].filter((d) => monthOf(d) === thisMonth)).size;
  check("özet: bu ay A1 gün sayısı doğru", days(a1, thisMonth) === expectedA1, JSON.stringify(view.data));
  check("özet: geçen aylar ayrı satır", days(a1, monthOf(lastMonthDay)) !== undefined && monthOf(lastMonthDay) !== thisMonth);
  check("özet: A3 iki gün (bugün + geçen ay ayrı)", (days(a3, thisMonth) ?? 0) + (days(a3, monthOf(lastMonthDay)) ?? 0) === 2);
  check("özet: üye olmayan boş görür (view RLS'e tabi)", (await c.outsider.from("monthly_attendance_summary").select("personnel_id").eq("site_id", siteA)).data?.length === 0);
  check("özet: başka şantiyenin sahibi boş görür", (await c.owner2.from("monthly_attendance_summary").select("personnel_id").eq("site_id", siteA)).data?.length === 0);
  check("özet: admin görüntüleyebilir", (await c.admin.from("monthly_attendance_summary").select("personnel_id").eq("site_id", siteA)).data?.length! > 0);
  check("özet: anonim okuyamaz", denied(await createClient(url, anon).from("monthly_attendance_summary").select("personnel_id")));

  // ---------- personel silinince puantajı da silinir ----------
  await svc.from("personnel").delete().eq("id", a3);
  check("personel silinince puantajı da silinir (CASCADE)", ((await svc.from("attendance").select("id").eq("personnel_id", a3)).data?.length ?? 1) === 0);

  check("anonim puantaj okuyamaz", denied(await createClient(url, anon).from("attendance").select("id")));
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  if (siteIds.length) await svc.from("sites").delete().in("id", siteIds); // personnel/attendance CASCADE
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftAtt = siteIds.length ? await svc.from("attendance").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi", !left.data?.length && !leftSites.data?.length && !leftAtt.data?.length);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
