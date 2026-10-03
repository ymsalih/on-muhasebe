/** RLS testi: company_entries (şirket kasası) ve get_company_summary RPC'si.
 *  Her ortağın kasası ayrıdır; admin yalnızca okur. Geçici hesap açar, sonunda siler.
 *  Çalıştırma: npm run test:rls:company  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const tag = randomBytes(4).toString("hex");
const pw = () => randomBytes(12).toString("base64url") + "aA1";
const accounts = { admin: { role: "admin" }, p1: { role: "partner" }, p2: { role: "partner" } } as const;
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

try {
  for (const w of Object.keys(accounts) as Who[]) {
    cred[w] = { email: `t-${w}-${tag}@example.test`, password: pw() };
    const { data, error } = await svc.auth.admin.createUser({ ...cred[w], email_confirm: true });
    if (error) throw error;
    ids[w] = data.user.id;
    const { error: e2 } = await svc.from("users").insert({ id: ids[w], full_name: `T ${w} ${tag}`, email: cred[w].email, role: accounts[w].role, must_change_password: false });
    if (e2) throw e2;
  }
  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  const row = (owner: Who, over: Record<string, unknown> = {}) => ({ owner_id: ids[owner], entry_type: "income", entry_date: "2026-09-10", description: "Şirket işi", amount: 1000, ...over });

  // ---------- ekleme ----------
  const a = await c.p1.from("company_entries").insert(row("p1")).select("id").single();
  check("ortak kendi şirket kasasına kayıt ekleyebilir", !a.error, a.error?.message);
  const idA = a.data?.id as number;
  check("ortak başkası adına kayıt ekleyemez", !!(await c.p1.from("company_entries").insert(row("p2"))).error);
  check("admin kayıt ekleyemez", !!(await c.admin.from("company_entries").insert(row("admin"))).error);
  check("admin başkası adına da ekleyemez", !!(await c.admin.from("company_entries").insert(row("p1"))).error);
  check("anonim kayıt ekleyemez", !!(await createClient(url, anon).from("company_entries").insert(row("p1"))).error);
  check("tutar 0 reddedilir", !!(await c.p1.from("company_entries").insert(row("p1", { amount: 0 }))).error);
  check("negatif tutar reddedilir", !!(await c.p1.from("company_entries").insert(row("p1", { amount: -5 }))).error);
  check("geçersiz tür reddedilir", !!(await c.p1.from("company_entries").insert(row("p1", { entry_type: "transfer" }))).error);
  check("boş açıklama reddedilir", !!(await c.p1.from("company_entries").insert(row("p1", { description: "   " }))).error);
  check("tarihsiz kayıt reddedilir", !!(await c.p1.from("company_entries").insert(row("p1", { entry_date: null }))).error);

  await c.p1.from("company_entries").insert(row("p1", { entry_type: "expense", description: "Ofis gideri", amount: 300, entry_date: "2026-09-12" }));
  await c.p1.from("company_entries").insert(row("p1", { entry_type: "income", description: "Başka ay", amount: 5000, entry_date: "2026-08-01" }));
  await c.p2.from("company_entries").insert(row("p2", { description: "p2 geliri", amount: 7777 }));

  // ---------- okuma / izolasyon ----------
  check("ortak kendi kayıtlarını görür (3)", ((await c.p1.from("company_entries").select("id")).data ?? []).length === 3);
  check("ortak başka ortağın kayıtlarını göremez", ((await c.p1.from("company_entries").select("id").eq("owner_id", ids.p2)).data ?? []).length === 0);
  check("ikinci ortak yalnızca kendi kaydını görür (1)", ((await c.p2.from("company_entries").select("id")).data ?? []).length === 1);
  check("admin tüm ortakların kayıtlarını görür (4)", ((await c.admin.from("company_entries").select("id").in("owner_id", [ids.p1, ids.p2])).data ?? []).length === 4);
  check("anonim okuyamaz", denied(await createClient(url, anon).from("company_entries").select("id")));

  // ---------- güncelleme / silme ----------
  check("ortak kendi kaydını güncelleyebilir", (await c.p1.from("company_entries").update({ amount: 1200 }).eq("id", idA).select("id")).data?.length === 1);
  check("ortak başkasının kaydını güncelleyemez", denied(await c.p2.from("company_entries").update({ amount: 1 }).eq("id", idA).select("id")));
  check("admin kayıt güncelleyemez", denied(await c.admin.from("company_entries").update({ amount: 1 }).eq("id", idA).select("id")));
  check("kaydın sahibi (owner_id) değiştirilemez", !!(await c.p1.from("company_entries").update({ owner_id: ids.p2 }).eq("id", idA)).error);
  check("ortak başkasının kaydını silemez", denied(await c.p2.from("company_entries").delete().eq("id", idA).select("id")));
  check("admin kayıt silemez", denied(await c.admin.from("company_entries").delete().eq("id", idA).select("id")));

  // ---------- kâr/zarar özeti ----------
  const sep = await c.p1.rpc("get_company_summary", { p_owner: ids.p1, p_from: "2026-09-01", p_to: "2026-09-30" });
  const s = (sep.data as { income: string; expense: string; entry_count: number }[] | null)?.[0];
  check("Eylül özeti: gelir 1200, gider 300 (kâr 900)", Number(s?.income) === 1200 && Number(s?.expense) === 300 && s?.entry_count === 2, JSON.stringify(sep.data));
  const year = await c.p1.rpc("get_company_summary", { p_owner: ids.p1, p_from: "2026-01-01", p_to: "2026-12-31" });
  const y = (year.data as { income: string; expense: string }[] | null)?.[0];
  check("Yıl özeti: gelir 6200, gider 300", Number(y?.income) === 6200 && Number(y?.expense) === 300, JSON.stringify(year.data));
  const other = await c.p1.rpc("get_company_summary", { p_owner: ids.p2, p_from: "2026-01-01", p_to: "2026-12-31" });
  check("başka ortağın özeti sıfır döner (p2'nin 7777'si sızmaz)", Number((other.data as { income: string }[])?.[0]?.income) === 0);
  const adm = await c.admin.rpc("get_company_summary", { p_owner: ids.p2, p_from: "2026-01-01", p_to: "2026-12-31" });
  check("admin başka ortağın özetini görebilir (7777)", Number((adm.data as { income: string }[])?.[0]?.income) === 7777, JSON.stringify(adm.data));
  check("anonim özet çağıramaz", !!(await createClient(url, anon).rpc("get_company_summary", { p_owner: ids.p1, p_from: "2026-01-01", p_to: "2026-12-31" })).error);

  check("ortak kendi kaydını silebilir", (await c.p1.from("company_entries").delete().eq("id", idA).select("id")).data?.length === 1);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id); // company_entries CASCADE
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftRows = await svc.from("company_entries").select("id").in("owner_id", Object.values(ids));
  check("test verisi temizlendi", !left.data?.length && !leftRows.data?.length);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
