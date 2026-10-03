/** RLS/bütünlük testi: giderin kaynağı (transactions.source_income_id), get_income_allocations ve get_expense_source_split RPC'leri.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:income-source  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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
  const { data: hak } = await svc.from("categories").select("id").is("site_id", null).eq("name", "Hakediş").eq("type", "income").single();

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  const tx = (who: Who, over: Record<string, unknown> = {}) => ({ site_id: siteA, user_id: ids[who], type: "expense", description: "Gider", amount: 100, transaction_date: "2026-09-10", ...over });

  // ---------- gelirler ----------
  const i1 = await c.owner.from("transactions").insert(tx("owner", { type: "income", description: "1. hakediş", amount: 10000, category_id: hak!.id, transaction_date: "2026-09-01" })).select("id").single();
  const i2 = await c.owner.from("transactions").insert(tx("owner", { type: "income", description: "Müşteri avansı", amount: 5000, transaction_date: "2026-09-05" })).select("id").single();
  const iOld = await c.owner.from("transactions").insert(tx("owner", { type: "income", description: "Eski gelir", amount: 800, transaction_date: "2026-07-01" })).select("id").single();
  check("gelirler eklendi", !!i1.data && !!i2.data && !!iOld.data, JSON.stringify([i1.error, i2.error, iOld.error]));
  const iB = await c.owner2.from("transactions").insert(tx("owner2", { site_id: siteB, type: "income", description: "B geliri", amount: 999, transaction_date: "2026-09-01" })).select("id").single();

  // ---------- giderin kaynağı ----------
  const e1 = await c.owner.from("transactions").insert(tx("owner", { amount: 3000, source_income_id: i1.data!.id })).select("id, source_income_id").single();
  check("gider, aynı şantiyenin gelirini kaynak olarak seçebilir", !e1.error && e1.data?.source_income_id === i1.data!.id, e1.error?.message);
  const e2 = await c.partner.from("transactions").insert(tx("partner", { amount: 2000, source_income_id: i1.data!.id })).select("id").single();
  check("ortak da aynı gelire bağlı gider ekleyebilir", !e2.error, e2.error?.message);
  const e3 = await c.owner.from("transactions").insert(tx("owner", { amount: 1000 })).select("id, source_income_id").single();
  check("kaynaksız gider serbest (opsiyonel)", !e3.error && e3.data?.source_income_id === null);
  const e4 = await c.owner.from("transactions").insert(tx("owner", { amount: 400, source_income_id: i2.data!.id, transaction_date: "2026-10-20" })).select("id").single();
  check("kaynağın tarihinden sonraki aya yazılan gider de bağlanabilir", !e4.error, e4.error?.message);
  const e5 = await c.owner.from("transactions").insert(tx("owner", { amount: 50, source_income_id: iOld.data!.id })).select("id").single();
  check("eski tarihli gelire de bağlanabilir", !e5.error);

  const bad = async (name: string, r: { error: { code?: string } | null }, code?: string) => check(name, !!r.error && (!code || r.error.code === code), JSON.stringify(r.error));
  await bad("kaynak olarak gider seçilemez (trigger)", await c.owner.from("transactions").insert(tx("owner", { source_income_id: e1.data!.id })), "23503");
  await bad("başka şantiyenin gelirine bağlanamaz (bileşik FK/trigger)", await c.owner.from("transactions").insert(tx("owner", { source_income_id: iB.data!.id })), "23503");
  await bad("var olmayan gelire bağlanamaz", await c.owner.from("transactions").insert(tx("owner", { source_income_id: 999999999 })), "23503");
  await bad("gelire kaynak yazılamaz (CHECK)", await c.owner.from("transactions").insert(tx("owner", { type: "income", source_income_id: i1.data!.id })), "23514");
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: kaynaklı gider ekleyemez`, !!(await c[w].from("transactions").insert(tx(w, { source_income_id: i1.data!.id }))).error);
  }

  // ---------- güncelleme ----------
  check("giderin kaynağı değiştirilebilir", (await c.owner.from("transactions").update({ source_income_id: i2.data!.id }).eq("id", e3.data!.id).select("id")).data?.length === 1);
  check("giderin kaynağı temizlenebilir (null)", (await c.owner.from("transactions").update({ source_income_id: null }).eq("id", e3.data!.id).select("id")).data?.length === 1);
  await bad("giderin kaynağı gider olamaz (güncellemede trigger)", await c.owner.from("transactions").update({ source_income_id: e1.data!.id }).eq("id", e3.data!.id), "23503");
  await bad("giderin kaynağı başka şantiyenin geliri olamaz (güncellemede)", await c.owner.from("transactions").update({ source_income_id: iB.data!.id }).eq("id", e3.data!.id), "23503");
  await bad("kaynaklı gider, kaynağı silmeden gelire çevrilemez (CHECK)", await c.owner.from("transactions").update({ type: "income", category_id: null }).eq("id", e1.data!.id), "23514");
  check("viewer kaynağı değiştiremez", denied(await c.viewer.from("transactions").update({ source_income_id: null }).eq("id", e1.data!.id).select("id")));
  check("admin kaynağı değiştiremez", denied(await c.admin.from("transactions").update({ source_income_id: null }).eq("id", e1.data!.id).select("id")));

  // ---------- bütünlük: bağlı gideri olan gelir ----------
  await bad("bağlı gideri olan gelir silinemez", await c.owner.from("transactions").delete().eq("id", i1.data!.id), "23503");
  await bad("bağlı gideri olan gelir, gider türüne çevrilemez (trigger)", await c.owner.from("transactions").update({ type: "expense", category_id: null }).eq("id", i1.data!.id), "23503");
  check("gelir hâlâ duruyor", ((await svc.from("transactions").select("id, type").eq("id", i1.data!.id)).data ?? [])[0]?.type === "income");

  // ---------- gelir/gider dağılımı RPC ----------
  const allocAll = await c.owner.rpc("get_income_allocations", { p_site_id: siteA, p_from: null, p_to: null, p_limit: 100 });
  const rows = (allocAll.data as { income_id: number; amount: string; spent: string; expense_count: number; description: string }[]) ?? [];
  const get = (id: number) => rows.find((r) => r.income_id === id);
  check("dağılım: 3 gelir (hepsi, tarih boş)", rows.length === 3, JSON.stringify(rows));
  check("dağılım: 1. hakediş 10000, harcanan 5000, 2 gider", Number(get(i1.data!.id)?.amount) === 10000 && Number(get(i1.data!.id)?.spent) === 5000 && get(i1.data!.id)?.expense_count === 2);
  check("dağılım: avans 5000, harcanan 400 (ay sonrası gider de sayılır)", Number(get(i2.data!.id)?.spent) === 400 && get(i2.data!.id)?.expense_count === 1);
  check("dağılım: eski gelir 800, harcanan 50", Number(get(iOld.data!.id)?.spent) === 50);
  check("dağılım: en yeni gelir başta", rows[0]?.income_id === i2.data!.id);
  const allocRange = await c.owner.rpc("get_income_allocations", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30", p_limit: 100 });
  const rr = (allocRange.data as { income_id: number; spent: string }[]) ?? [];
  check("dağılım (eylül): yalnızca eylül gelirleri (2), eski gelir yok", rr.length === 2 && !rr.some((r) => r.income_id === iOld.data!.id));
  check("dağılım (eylül): avansın harcananı ekim giderini de içerir (400)", Number(rr.find((r) => r.income_id === i2.data!.id)?.spent) === 400);
  const lim = await c.owner.rpc("get_income_allocations", { p_site_id: siteA, p_from: null, p_to: null, p_limit: 1 });
  check("dağılım: limit uygulanır", ((lim.data as unknown[]) ?? []).length === 1);
  check("dağılım: partner (üye) görebilir", ((await c.partner.rpc("get_income_allocations", { p_site_id: siteA, p_from: null, p_to: null, p_limit: 100 })).data as unknown[])?.length === 3);
  check("dağılım: viewer görebilir (salt okur)", ((await c.viewer.rpc("get_income_allocations", { p_site_id: siteA, p_from: null, p_to: null, p_limit: 100 })).data as unknown[])?.length === 3);
  check("dağılım: admin görebilir", ((await c.admin.rpc("get_income_allocations", { p_site_id: siteA, p_from: null, p_to: null, p_limit: 100 })).data as unknown[])?.length === 3);
  check("dağılım: üye olmayan boş görür", ((await c.outsider.rpc("get_income_allocations", { p_site_id: siteA, p_from: null, p_to: null, p_limit: 100 })).data as unknown[])?.length === 0);
  check("dağılım: başka şantiyenin ortağı A'yı göremez", ((await c.owner2.rpc("get_income_allocations", { p_site_id: siteA, p_from: null, p_to: null, p_limit: 100 })).data as unknown[])?.length === 0);
  check("dağılım: B'nin geliri (999) A'ya sızmaz", !JSON.stringify(allocAll.data).includes("B geliri"));
  check("dağılım: anonim çağıramaz", !!(await createClient(url, anon).rpc("get_income_allocations", { p_site_id: siteA, p_from: null, p_to: null, p_limit: 5 })).error);

  // ---------- kaynaklı / kaynaksız gider toplamı ----------
  // eylül giderleri: e1 3000 + e2 2000 (kaynaklı), e3 1000 (kaynaksız), e5 50 (kaynaklı, tarih 10.09); e4 ekimde
  const split = await c.owner.rpc("get_expense_source_split", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" });
  const sp = (split.data as { linked: string; linked_count: number; unlinked: string; unlinked_count: number }[])?.[0];
  check("kaynak dağılımı (eylül): kaynaklı 5050 (3 kayıt), kaynaksız 1000 (1 kayıt)", Number(sp?.linked) === 5050 && sp?.linked_count === 3 && Number(sp?.unlinked) === 1000 && sp?.unlinked_count === 1, JSON.stringify(sp));
  check("kaynak dağılımı: üye olmayan sıfır görür", Number((((await c.outsider.rpc("get_expense_source_split", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).data as { linked: string }[])?.[0])?.linked) === 0);
  check("kaynak dağılımı: anonim çağıramaz", !!(await createClient(url, anon).rpc("get_expense_source_split", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).error);

  // ---------- süzme (liste sorguları) ----------
  const forSrc = await c.owner.from("transactions").select("id").eq("site_id", siteA).eq("type", "expense").eq("source_income_id", i1.data!.id);
  check("süzgeç: belirli gelirin giderleri (2)", (forSrc.data ?? []).length === 2);
  const anyS = await c.owner.from("transactions").select("id").eq("site_id", siteA).eq("type", "expense").not("source_income_id", "is", null);
  check("süzgeç: kaynaklı giderler (4)", (anyS.data ?? []).length === 4);
  const noneS = await c.owner.from("transactions").select("id").eq("site_id", siteA).eq("type", "expense").is("source_income_id", null);
  check("süzgeç: kaynaksız giderler (1)", (noneS.data ?? []).length === 1);

  // ---------- silme sırası ve hesap güncellemesi ----------
  check("gider silinince gelirin harcananı azalır", (await c.partner.from("transactions").delete().eq("id", e2.data!.id).select("id")).data?.length === 1 && Number(((await c.owner.rpc("get_income_allocations", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30", p_limit: 100 })).data as { income_id: number; spent: string }[]).find((r) => r.income_id === i1.data!.id)?.spent) === 3000);
  check("bağlı gider kalmayınca gelir silinebilir", (await c.owner.from("transactions").delete().eq("id", e1.data!.id).select("id")).data?.length === 1 && (await c.owner.from("transactions").delete().eq("id", i1.data!.id).select("id")).data?.length === 1);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  // Şantiye silinirken kendine bağlı (self-FK) gelir/giderler birlikte gider
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftTx = siteIds.length ? await svc.from("transactions").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi (bağlı gelir/giderli şantiye CASCADE ile silinir)", !delErr && !left.data?.length && !leftSites.data?.length && !leftTx.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
