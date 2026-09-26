/** RLS/doğruluk testi (Faz 8b): get_cash_trend, get_party_report, get_personnel_report RPC'leri.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:reports  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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
  viewer: { role: "partner" },
  outsider: { role: "partner" },
  owner2: { role: "partner" },
} as const;
type Who = keyof typeof accounts;
const cred = {} as Record<Who, { email: string; password: string }>;
const ids = {} as Record<Who, string>;
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);

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
  const siteA = await mkSite("A", [["owner", "owner"], ["viewer", "viewer"]]);
  const siteB = await mkSite("B", [["owner2", "owner"]]);

  const { data: pa } = await svc.from("parties").insert({ site_id: siteA, name: `Firma A ${tag}`, category: "firma" }).select("id").single();
  const { data: pb } = await svc.from("parties").insert({ site_id: siteB, name: `Firma B ${tag}`, category: "firma" }).select("id").single();
  const { data: perA } = await svc.from("personnel").insert({ site_id: siteA, status: "aktif", full_name: `Kisi A ${tag}` }).select("id").single();
  const { data: perB } = await svc.from("personnel").insert({ site_id: siteB, status: "aktif", full_name: `Kisi B ${tag}` }).select("id").single();

  const tx = (site: number, user: string, over: Record<string, unknown>) => ({ site_id: site, user_id: user, description: "Rapor testi", ...over });
  await svc.from("transactions").insert([
    tx(siteA, ids.owner, { type: "income", amount: 1000, transaction_date: "2026-08-05" }),
    tx(siteA, ids.owner, { type: "expense", amount: 300, transaction_date: "2026-08-05", party_id: pa!.id }),
    tx(siteA, ids.owner, { type: "expense", amount: 200, transaction_date: "2026-09-02" }),
    tx(siteA, ids.owner, { type: "income", amount: 500, transaction_date: "2026-09-02", party_id: pa!.id }),
    tx(siteA, ids.owner, { type: "expense", amount: 4500, transaction_date: "2026-09-30", personnel_id: perA!.id, work_days: 3, daily_rate: 1500, period_month: "2026-09-01" }),
    tx(siteB, ids.owner2, { type: "expense", amount: 9999, transaction_date: "2026-09-02", party_id: pb!.id }),
  ]);
  await svc.from("goods_entries").insert({ site_id: siteA, entry_date: "2026-09-03", document_type: "fatura", party_id: pa!.id, quantity: 10, unit_price: 100, created_by: ids.owner });
  await svc.from("attendance").insert([1, 2, 3].map((d) => ({ site_id: siteA, personnel_id: perA!.id, work_date: `2026-09-0${d}`, recorded_by: ids.owner })));
  await svc.from("attendance").insert({ site_id: siteB, personnel_id: perB!.id, work_date: "2026-09-01", recorded_by: ids.owner2 });

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  // ---------- trend ----------
  const day = await c.owner.rpc("get_cash_trend", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30", p_bucket: "day" });
  const d2 = (day.data as { period: string; income: string; expense: string }[] | null)?.find((r) => r.period === "2026-09-02");
  check("trend (gün): 02.09 gelir 500, gider 200", Number(d2?.income) === 500 && Number(d2?.expense) === 200, JSON.stringify(day.data));
  check("trend (gün): yalnızca hareketli günler döner (2 gün)", (day.data as unknown[] | null)?.length === 2);
  const mon = await c.owner.rpc("get_cash_trend", { p_site_id: siteA, p_from: "2026-08-01", p_to: "2026-09-30", p_bucket: "month" });
  const rows = mon.data as { period: string; income: string; expense: string }[] | null;
  check("trend (ay): Ağustos 1000/300, Eylül 500/4700", Number(rows?.[0]?.income) === 1000 && Number(rows?.[0]?.expense) === 300 && Number(rows?.[1]?.income) === 500 && Number(rows?.[1]?.expense) === 4700, JSON.stringify(rows));
  check("trend: geçersiz kırılım reddedilir", !!(await c.owner.rpc("get_cash_trend", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30", p_bucket: "year" })).error);
  check("trend: viewer okuyabilir", ((await c.viewer.rpc("get_cash_trend", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30", p_bucket: "day" })).data as unknown[])?.length === 2);
  check("trend: admin okuyabilir (salt okunur)", ((await c.admin.rpc("get_cash_trend", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30", p_bucket: "day" })).data as unknown[])?.length === 2);
  check("trend: üye olmayan boş döner", ((await c.outsider.rpc("get_cash_trend", { p_site_id: siteA, p_from: "2026-08-01", p_to: "2026-09-30", p_bucket: "day" })).data as unknown[])?.length === 0);
  check("trend: başka şantiyenin ortağı boş döner", ((await c.owner2.rpc("get_cash_trend", { p_site_id: siteA, p_from: "2026-08-01", p_to: "2026-09-30", p_bucket: "day" })).data as unknown[])?.length === 0);
  check("trend: anonim çağıramaz", !!(await createClient(url, anon).rpc("get_cash_trend", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30", p_bucket: "day" })).error);

  // ---------- cari raporu ----------
  const pr = await c.owner.rpc("get_party_report", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" });
  const prow = (pr.data as { party_id: number; invoiced: string; paid: string; collected: string }[] | null)?.[0];
  check("cari raporu: Eylül faturalanan 1000, ödenen 0, tahsilat 500", Number(prow?.invoiced) === 1000 && Number(prow?.paid) === 0 && Number(prow?.collected) === 500, JSON.stringify(pr.data));
  const pr2 = await c.owner.rpc("get_party_report", { p_site_id: siteA, p_from: "2026-08-01", p_to: "2026-08-31" });
  check("cari raporu: Ağustos ödenen 300", Number((pr2.data as { paid: string }[] | null)?.[0]?.paid) === 300, JSON.stringify(pr2.data));
  check("cari raporu: hareketsiz dönemde boş", ((await c.owner.rpc("get_party_report", { p_site_id: siteA, p_from: "2026-01-01", p_to: "2026-01-31" })).data as unknown[])?.length === 0);
  check("cari raporu: üye olmayan boş görür", ((await c.outsider.rpc("get_party_report", { p_site_id: siteA, p_from: "2026-08-01", p_to: "2026-09-30" })).data as unknown[])?.length === 0);
  check("cari raporu: başka şantiyenin ortağı A'nın carisini göremez", ((await c.owner2.rpc("get_party_report", { p_site_id: siteA, p_from: "2026-08-01", p_to: "2026-09-30" })).data as unknown[])?.length === 0);
  check("cari raporu: B'nin verisi A'ya sızmaz (9999 yok)", !JSON.stringify(pr.data).includes("9999"));

  // ---------- personel raporu ----------
  const ps = await c.owner.rpc("get_personnel_report", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" });
  const psr = (ps.data as { personnel_id: number; days_worked: number; paid: string }[] | null)?.[0];
  check("personel raporu: 3 gün, ödenen 4500", psr?.days_worked === 3 && Number(psr?.paid) === 4500, JSON.stringify(ps.data));
  check("personel raporu: dönem dışı boş", ((await c.owner.rpc("get_personnel_report", { p_site_id: siteA, p_from: "2026-01-01", p_to: "2026-01-31" })).data as unknown[])?.length === 0);
  check("personel raporu: viewer okuyabilir", ((await c.viewer.rpc("get_personnel_report", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).data as unknown[])?.length === 1);
  check("personel raporu: üye olmayan boş görür", ((await c.outsider.rpc("get_personnel_report", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).data as unknown[])?.length === 0);
  check("personel raporu: başka şantiyenin ortağı boş görür", ((await c.owner2.rpc("get_personnel_report", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).data as unknown[])?.length === 0);
  check("personel raporu: anonim çağıramaz", !!(await createClient(url, anon).rpc("get_personnel_report", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).error);
  const psB = await c.owner2.rpc("get_personnel_report", { p_site_id: siteB, p_from: "2026-09-01", p_to: "2026-09-30" });
  check("personel raporu: B kendi personelini görür (1 gün)", (psB.data as { days_worked: number }[] | null)?.[0]?.days_worked === 1);
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
