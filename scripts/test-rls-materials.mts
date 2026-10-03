/** RLS/doğruluk testi: material_entries (malzeme girişleri, maliyet) ve get_material_cost_breakdown RPC'si.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:materials  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  const row = (who: Who, over: Record<string, unknown> = {}) => ({
    site_id: siteA, entry_date: "2026-09-10", name: `Çimento ${tag}`, unit: "torba", quantity: 100, unit_price: 50, created_by: ids[who], ...over,
  });

  // ---------- ekleme ----------
  const e1 = await c.owner.from("material_entries").insert(row("owner")).select("id, total_amount").single();
  check("sahip malzeme girişi ekleyebilir", !e1.error, e1.error?.message);
  check("maliyet = miktar × birim fiyat (5000)", Number(e1.data?.total_amount) === 5000, String(e1.data?.total_amount));
  const e2 = await c.partner.from("material_entries").insert(row("partner", { name: `Demir ${tag}`, unit: "kg", quantity: 12.5, unit_price: 80.25, used_for: "B Blok temel", supplier: "Tedarikçi" })).select("id, total_amount").single();
  check("ortak malzeme girişi ekleyebilir", !e2.error, e2.error?.message);
  check("kuruşlu maliyet doğru yuvarlanır (12,5 × 80,25 = 1003,13)", Number(e2.data?.total_amount) === 1003.13, String(e2.data?.total_amount));
  const e3 = await c.partner.from("material_entries").insert(row("partner", { quantity: 10, unit_price: 100, entry_date: "2026-08-05" })).select("id").single();
  check("ağustos girişi eklenebilir (10 × 100)", !e3.error);
  check("fiyatsız giriş reddedilir (fiyat zorunlu)", !!(await c.owner.from("material_entries").insert(row("owner", { unit_price: null }))).error);
  check("negatif fiyat reddedilir", !!(await c.owner.from("material_entries").insert(row("owner", { unit_price: -1 }))).error);
  check("sıfır fiyat serbest (hediye/bağış malzeme)", !(await c.owner.from("material_entries").insert(row("owner", { unit_price: 0, name: `Bağış ${tag}` }))).error);
  check("sıfır miktar reddedilir", !!(await c.owner.from("material_entries").insert(row("owner", { quantity: 0 }))).error);
  check("birimsiz giriş reddedilir", !!(await c.owner.from("material_entries").insert(row("owner", { unit: "" }))).error);
  check("2 harften kısa ad reddedilir", !!(await c.owner.from("material_entries").insert(row("owner", { name: "x" }))).error);
  check("maliyet sütunu elle yazılamaz", !!(await c.owner.from("material_entries").insert(row("owner", { total_amount: 1 }))).error);
  check("başkası adına (created_by) giriş yazılamaz", !!(await c.partner.from("material_entries").insert(row("owner"))).error);
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: giriş ekleyemez`, !!(await c[w].from("material_entries").insert(row(w))).error);
  }
  await c.owner2.from("material_entries").insert(row("owner2", { site_id: siteB, name: `B malzemesi ${tag}`, quantity: 1, unit_price: 9999 }));

  // ---------- okuma / izolasyon ----------
  check("üye olmayan girişleri göremez", ((await c.outsider.from("material_entries").select("id").eq("site_id", siteA)).data ?? []).length === 0);
  check("başka şantiyenin ortağı A'yı göremez", ((await c.owner2.from("material_entries").select("id").eq("site_id", siteA)).data ?? []).length === 0);
  check("viewer hiçbir giriş göremez (başkalarının kayıtları kendine özeldir)", ((await c.viewer.from("material_entries").select("id").eq("site_id", siteA)).data ?? []).length === 0);
  check("admin tüm ortakların girişlerini görebilir (4)", ((await c.admin.from("material_entries").select("id").eq("site_id", siteA)).data ?? []).length === 4);
  check("sahip yalnızca kendi girişlerini görür (2)", ((await c.owner.from("material_entries").select("id").eq("site_id", siteA)).data ?? []).length === 2);
  check("ortak yalnızca kendi girişlerini görür (2)", ((await c.partner.from("material_entries").select("id").eq("site_id", siteA)).data ?? []).length === 2);
  check("ortak, sahibin girişini göremez", ((await c.partner.from("material_entries").select("id").eq("id", e1.data!.id)).data ?? []).length === 0);
  check("sahip, ortağın girişini göremez", ((await c.owner.from("material_entries").select("id").eq("id", e2.data!.id)).data ?? []).length === 0);
  check("anonim okuyamaz", denied(await createClient(url, anon).from("material_entries").select("id")));

  // ---------- kullanım yeri sonradan eklenir ----------
  const up = await c.owner.from("material_entries").update({ used_for: "A Blok kolon betonu" }).eq("id", e1.data!.id).select("used_for, total_amount");
  check("kullanım yeri sonradan eklenebilir", up.data?.[0]?.used_for === "A Blok kolon betonu" && Number(up.data[0].total_amount) === 5000, JSON.stringify(up));
  const up2 = await c.owner.from("material_entries").update({ unit_price: 60 }).eq("id", e1.data!.id).select("total_amount");
  check("birim fiyat değişince maliyet yeniden hesaplanır (6000)", Number(up2.data?.[0]?.total_amount) === 6000, JSON.stringify(up2));
  await c.owner.from("material_entries").update({ unit_price: 50 }).eq("id", e1.data!.id);
  check("ortak başkasının girişini güncelleyemez", denied(await c.partner.from("material_entries").update({ used_for: "ele geçirme" }).eq("id", e1.data!.id).select("id")));
  check("viewer güncelleyemez", denied(await c.viewer.from("material_entries").update({ used_for: "x" }).eq("id", e1.data!.id).select("id")));
  check("admin güncelleyemez", denied(await c.admin.from("material_entries").update({ used_for: "x" }).eq("id", e1.data!.id).select("id")));
  check("üye olmayan güncelleyemez", denied(await c.outsider.from("material_entries").update({ used_for: "x" }).eq("id", e1.data!.id).select("id")));
  check("şantiye (site_id) değiştirilemez", !!(await c.owner.from("material_entries").update({ site_id: siteB }).eq("id", e1.data!.id)).error);
  check("giren (created_by) değiştirilemez", !!(await c.owner.from("material_entries").update({ created_by: ids.partner }).eq("id", e1.data!.id)).error);
  check("maliyet sütunu güncellenemez", !!(await c.owner.from("material_entries").update({ total_amount: 1 }).eq("id", e1.data!.id)).error);

  // ---------- maliyet kırılımı ----------
  // A şantiyesi, 1–30 Eylül: owner: 5000 (+ 0 bağış) ; partner: 1003,13
  const range = { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" };
  const byPartner = await c.owner.rpc("get_material_cost_breakdown", { ...range, p_by: "partner" });
  const bp = (byPartner.data as { group_key: string; label: string; entry_count: number; total: string }[]) ?? [];
  check("ortak bazında (sahip): yalnızca kendisi, 5000, 2 giriş — ortağın 1003,13'ü sızmaz", bp.length === 1 && Number(bp[0].total) === 5000 && bp[0].group_key === ids.owner && bp[0].entry_count === 2, JSON.stringify(bp));
  const adm = await c.admin.rpc("get_material_cost_breakdown", { ...range, p_by: "partner" });
  const ap = (adm.data as { group_key: string; label: string; total: string }[]) ?? [];
  check("ortak bazında (admin): 2 ortak ayrı ayrı, en pahalı başta (5000, 1003,13)", ap.length === 2 && Number(ap[0].total) === 5000 && ap[0].group_key === ids.owner && Number(ap[1].total) === 1003.13, JSON.stringify(ap));
  check("ortak bazında (admin): ortağın adı görünür", ap[1]?.label === `T partner ${tag}`, ap[1]?.label);
  const pp = await c.partner.rpc("get_material_cost_breakdown", { ...range, p_by: "partner" });
  check("ortak bazında (ortak): yalnızca kendisi, 1003,13", (pp.data as { total: string }[])?.length === 1 && Number((pp.data as { total: string }[])[0].total) === 1003.13, JSON.stringify(pp.data));
  const byItem = await c.owner.rpc("get_material_cost_breakdown", { ...range, p_by: "item" });
  const bi = (byItem.data as { label: string; unit: string; total_quantity: string; total: string }[]) ?? [];
  check("malzeme bazında: Çimento 100 torba 5000 başta", bi[0]?.label === `Çimento ${tag}` && bi[0].unit === "torba" && Number(bi[0].total_quantity) === 100 && Number(bi[0].total) === 5000, JSON.stringify(bi));
  check("malzeme bazında (sahip): 2 malzeme (çimento, bağış); ortağın demiri yok", bi.length === 2 && !JSON.stringify(bi).includes("Demir"));
  const byUsage = await c.owner.rpc("get_material_cost_breakdown", { ...range, p_by: "usage" });
  const bu = (byUsage.data as { label: string; total: string }[]) ?? [];
  check("kullanım yerine göre: A Blok kolon betonu 5000", bu.some((r) => r.label === "A Blok kolon betonu" && Number(r.total) === 5000), JSON.stringify(bu));
  check("kullanım yerine göre (sahip): ortağın 'B Blok temel' kaydı görünmez", !bu.some((r) => r.label === "B Blok temel"));
  check("kullanım yerine göre: yeri girilmemiş giriş 'Belirtilmemiş' altında (0 ₺ bağış)", bu.some((r) => r.label === "Belirtilmemiş"));
  const augRange = { p_site_id: siteA, p_from: "2026-08-01", p_to: "2026-08-31", p_by: "partner" };
  const aug = await c.partner.rpc("get_material_cost_breakdown", augRange);
  check("ağustos dönemi (ortak): kendi ağustos girişi 1000", (aug.data as { total: string }[])?.length === 1 && Number((aug.data as { total: string }[])[0].total) === 1000);
  check("ağustos dönemi (sahip): boş — ortağın girişi görünmez", ((await c.owner.rpc("get_material_cost_breakdown", augRange)).data as unknown[])?.length === 0);
  check("geçersiz kırılım reddedilir", !!(await c.owner.rpc("get_material_cost_breakdown", { ...range, p_by: "year" })).error);
  check("viewer kırılımı boş (kendi girişi yok)", ((await c.viewer.rpc("get_material_cost_breakdown", { ...range, p_by: "partner" })).data as unknown[])?.length === 0);
  check("üye olmayan boş görür", ((await c.outsider.rpc("get_material_cost_breakdown", { ...range, p_by: "partner" })).data as unknown[])?.length === 0);
  const leak = await c.owner2.rpc("get_material_cost_breakdown", { ...range, p_by: "item" });
  check("başka şantiyenin ortağı A'yı göremez", ((leak.data as unknown[]) ?? []).length === 0);
  const ownB = await c.owner2.rpc("get_material_cost_breakdown", { p_site_id: siteB, p_from: "2026-09-01", p_to: "2026-09-30", p_by: "item" });
  check("B'nin sahibi kendi şantiyesini görür (1 malzeme, 9999)", ((ownB.data as { total: string }[]) ?? []).length === 1 && Number((ownB.data as { total: string }[])[0].total) === 9999);
  const bB = await c.owner.rpc("get_material_cost_breakdown", { p_site_id: siteB, p_from: "2026-09-01", p_to: "2026-09-30", p_by: "item" });
  check("A'nın sahibi B şantiyesini göremez (9999 sızmaz)", ((bB.data as unknown[]) ?? []).length === 0);
  check("anonim kırılım çağıramaz", !!(await createClient(url, anon).rpc("get_material_cost_breakdown", { ...range, p_by: "partner" })).error);

  // ---------- silme ----------
  check("ortak sahibin girişini silemez", denied(await c.partner.from("material_entries").delete().eq("id", e1.data!.id).select("id")));
  check("viewer giriş silemez", denied(await c.viewer.from("material_entries").delete().eq("id", e1.data!.id).select("id")));
  check("admin giriş silemez", denied(await c.admin.from("material_entries").delete().eq("id", e1.data!.id).select("id")));
  check("üye olmayan giriş silemez", denied(await c.outsider.from("material_entries").delete().eq("id", e1.data!.id).select("id")));
  check("ortak giriş silebilir", (await c.partner.from("material_entries").delete().eq("id", e3.data!.id).select("id")).data?.length === 1);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftRows = siteIds.length ? await svc.from("material_entries").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi", !delErr && !left.data?.length && !leftSites.data?.length && !leftRows.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
