/** RLS/doğruluk testi: materials, material_movements, stok eksiye düşme koruması ve get_material_summary RPC'si.
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
  const { data: matB } = await svc.from("materials").insert({ site_id: siteB, name: `B Malzemesi ${tag}`, unit: "adet" }).select("id").single();

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  // ---------- malzeme kartı ----------
  const m1 = await c.partner.from("materials").insert({ site_id: siteA, name: `Çimento ${tag}`, variant: "CEM I 42,5", unit: "torba" }).select("id").single();
  check("ortak malzeme ekleyebilir", !m1.error, m1.error?.message);
  const mid = m1.data!.id as number;
  const dup = await c.partner.from("materials").insert({ site_id: siteA, name: `çimento ${tag}`, variant: "cem i 42,5", unit: "torba" });
  check("tekrar eden malzeme reddedilir (23505)", dup.error?.code === "23505", JSON.stringify(dup.error));
  check("aynı ad, farklı cins eklenebilir", !(await c.partner.from("materials").insert({ site_id: siteA, name: `Çimento ${tag}`, variant: "CEM II", unit: "torba" })).error);
  check("birimsiz malzeme reddedilir", !!(await c.partner.from("materials").insert({ site_id: siteA, name: `Birimsiz ${tag}`, unit: "" })).error);
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: malzeme ekleyemez`, !!(await c[w].from("materials").insert({ site_id: siteA, name: `Yetkisiz ${w} ${tag}`, unit: "adet" })).error);
  }
  check("üye olmayan malzemeleri göremez", ((await c.outsider.from("materials").select("id").eq("site_id", siteA)).data ?? []).length === 0);
  check("başka şantiyenin ortağı A'nın malzemelerini göremez", ((await c.owner2.from("materials").select("id").eq("site_id", siteA)).data ?? []).length === 0);
  check("viewer ve admin malzemeleri görebilir", ((await c.viewer.from("materials").select("id").eq("site_id", siteA)).data ?? []).length === 2 && ((await c.admin.from("materials").select("id").eq("site_id", siteA)).data ?? []).length === 2);
  check("malzemenin şantiyesi (site_id) değiştirilemez", !!(await c.partner.from("materials").update({ site_id: siteB }).eq("id", mid)).error);
  check("malzeme adı güncellenebilir", (await c.partner.from("materials").update({ name: `Çimento Y ${tag}` }).eq("id", mid).select("id")).data?.length === 1);
  check("viewer malzeme güncelleyemez", denied(await c.viewer.from("materials").update({ name: "x y z" }).eq("id", mid).select("id")));

  // ---------- hareketler ----------
  const mv = (over: Record<string, unknown> = {}) => ({ site_id: siteA, material_id: mid, movement_type: "in", movement_date: "2026-09-10", quantity: 100, unit_price: 50, created_by: ids.partner, ...over });
  const in1 = await c.partner.from("material_movements").insert(mv()).select("id").single();
  check("ortak giriş ekleyebilir (100 × 50)", !in1.error, in1.error?.message);
  const in2 = await c.partner.from("material_movements").insert(mv({ quantity: 100, unit_price: 70, movement_date: "2026-09-12" })).select("id").single();
  check("ikinci giriş (100 × 70)", !in2.error);
  const out1 = await c.partner.from("material_movements").insert(mv({ movement_type: "out", quantity: 60, unit_price: null, counterparty: "Taşeron A", movement_date: "2026-09-15" })).select("id").single();
  check("ortak çıkış ekleyebilir (60)", !out1.error, out1.error?.message);

  check("çıkışa fiyat yazılamaz", !!(await c.partner.from("material_movements").insert(mv({ movement_type: "out", quantity: 1, unit_price: 5 }))).error);
  check("sıfır miktar reddedilir", !!(await c.partner.from("material_movements").insert(mv({ quantity: 0 }))).error);
  check("negatif fiyat reddedilir", !!(await c.partner.from("material_movements").insert(mv({ unit_price: -1 }))).error);
  check("geçersiz tür reddedilir", !!(await c.partner.from("material_movements").insert(mv({ movement_type: "transfer" }))).error);
  check("başka şantiyenin malzemesine hareket yazılamaz (bileşik FK)", !!(await c.owner.from("material_movements").insert(mv({ material_id: matB!.id, created_by: ids.owner }))).error);
  check("başkası adına (created_by) hareket yazılamaz", !!(await c.partner.from("material_movements").insert(mv({ created_by: ids.owner }))).error);
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: hareket ekleyemez`, !!(await c[w].from("material_movements").insert(mv({ created_by: ids[w] }))).error);
  }

  // ---------- stok eksiye düşemez ----------
  // stok = 200 − 60 = 140
  const over = await c.partner.from("material_movements").insert(mv({ movement_type: "out", quantity: 141, unit_price: null }));
  check("stoktan fazla çıkış reddedilir (141 > 140)", over.error?.code === "23514" && /Stok eksiye/.test(over.error.message), JSON.stringify(over.error));
  check("tam stok kadar çıkış serbest (140)", !(await c.partner.from("material_movements").insert(mv({ movement_type: "out", quantity: 140, unit_price: null, movement_date: "2026-09-16" }))).error);
  const zero = await c.partner.from("material_movements").select("id").eq("movement_type", "out").eq("quantity", 140).single();
  check("stok 0'a düştü; 1 daha çıkış reddedilir", !!(await c.partner.from("material_movements").insert(mv({ movement_type: "out", quantity: 1, unit_price: null }))).error);
  check("kullanılmış girişin miktarı azaltılamaz", !!(await c.partner.from("material_movements").update({ quantity: 10 }).eq("id", in1.data!.id)).error);
  check("kullanılmış giriş silinemez", !!(await c.partner.from("material_movements").delete().eq("id", in1.data!.id)).error);
  check("çıkış silinince stok geri gelir", (await c.partner.from("material_movements").delete().eq("id", zero.data!.id).select("id")).data?.length === 1);
  check("giriş miktarı artırılabilir", (await c.partner.from("material_movements").update({ quantity: 120 }).eq("id", in1.data!.id).select("id")).data?.length === 1);

  // ---------- eşzamanlı çıkışlar: toplam stoğu aşamaz ----------
  const mc = (await c.partner.from("materials").insert({ site_id: siteA, name: `Eşzamanlı ${tag}`, unit: "adet" }).select("id").single()).data!.id as number;
  await c.partner.from("material_movements").insert(mv({ material_id: mc, quantity: 10, unit_price: 1 }));
  const race = await Promise.all(Array.from({ length: 5 }, () => c.partner.from("material_movements").insert(mv({ material_id: mc, movement_type: "out", quantity: 4, unit_price: null }))));
  const okCount = race.filter((r) => !r.error).length;
  const sum = ((await svc.from("material_movements").select("movement_type, quantity").eq("material_id", mc)).data ?? []).reduce((s, r) => s + (r.movement_type === "in" ? Number(r.quantity) : -Number(r.quantity)), 0);
  check("5 eşzamanlı çıkışta stok eksiye düşmez (en çok 2 başarılı)", okCount === 2 && sum === 2, `başarılı=${okCount}, stok=${sum}`);

  // ---------- güncelleme alanları ----------
  check("hareketin malzemesi değiştirilemez", !!(await c.partner.from("material_movements").update({ material_id: mc }).eq("id", in2.data!.id)).error);
  check("hareketin türü değiştirilemez", !!(await c.partner.from("material_movements").update({ movement_type: "out" }).eq("id", in2.data!.id)).error);
  check("viewer hareket güncelleyemez", denied(await c.viewer.from("material_movements").update({ note: "x" }).eq("id", in2.data!.id).select("id")));
  check("üye olmayan hareket silemez", denied(await c.outsider.from("material_movements").delete().eq("id", out1.data!.id).select("id")));
  check("admin hareket silemez", denied(await c.admin.from("material_movements").delete().eq("id", out1.data!.id).select("id")));
  check("üye olmayan hareketleri göremez", ((await c.outsider.from("material_movements").select("id").eq("site_id", siteA)).data ?? []).length === 0);
  check("admin hareketleri görebilir", ((await c.admin.from("material_movements").select("id").eq("site_id", siteA)).data ?? []).length > 0);
  check("anonim okuyamaz", denied(await createClient(url, anon).from("material_movements").select("id")));

  // ---------- malzeme silme ----------
  check("hareketi olan malzeme silinemez", !!(await c.partner.from("materials").delete().eq("id", mid)).error);
  const empty = (await c.partner.from("materials").insert({ site_id: siteA, name: `Boş ${tag}`, unit: "adet" }).select("id").single()).data!.id as number;
  check("hareketi olmayan malzeme silinebilir", (await c.partner.from("materials").delete().eq("id", empty).select("id")).data?.length === 1);

  // ---------- özet RPC ----------
  // mid: girişler 120×50 + 100×70 = 6000 + 7000; ortalama = 13000/220 = 59,0909…; çıkış 60; stok 160
  const sum1 = await c.partner.rpc("get_material_summary", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" });
  const row = (sum1.data as Record<string, string | number>[] | null)?.find((r) => r.material_id === mid);
  check("özet: stok 160", Number(row?.stock_qty) === 160, JSON.stringify(row));
  check("özet: ağırlıklı ortalama maliyet ≈ 59,09", Math.abs(Number(row?.avg_cost) - 13000 / 220) < 0.0001, String(row?.avg_cost));
  check("özet: stok değeri = 160 × ortalama (9454,55)", Number(row?.stock_value) === Math.round((160 * 13000) / 220 * 100) / 100, String(row?.stock_value));
  check("özet: dönem girişi 220 adet / 13000 ₺", Number(row?.period_in_qty) === 220 && Number(row?.period_in_amount) === 13000);
  check("özet: dönem çıkışı 60 adet / 60 × ortalama (3545,45)", Number(row?.period_out_qty) === 60 && Number(row?.period_out_amount) === Math.round((60 * 13000) / 220 * 100) / 100, JSON.stringify(row));
  const narrow = await c.partner.rpc("get_material_summary", { p_site_id: siteA, p_from: "2026-09-14", p_to: "2026-09-30" });
  const nrow = (narrow.data as Record<string, string | number>[] | null)?.find((r) => r.material_id === mid);
  check("dar dönemde yalnızca çıkış (giriş 0), stok yine 160", Number(nrow?.period_in_qty) === 0 && Number(nrow?.period_out_qty) === 60 && Number(nrow?.stock_qty) === 160);
  check("özet: viewer okuyabilir", ((await c.viewer.rpc("get_material_summary", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).data as unknown[]).length >= 2);
  check("özet: admin okuyabilir", ((await c.admin.rpc("get_material_summary", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).data as unknown[]).length >= 2);
  check("özet: üye olmayan boş görür", ((await c.outsider.rpc("get_material_summary", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).data as unknown[]).length === 0);
  check("özet: başka şantiyenin ortağı A'yı göremez, B sızmaz", !JSON.stringify((await c.owner2.rpc("get_material_summary", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).data).includes(tag));
  check("özet: anonim çağıramaz", !!(await createClient(url, anon).rpc("get_material_summary", { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" })).error);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  // CASCADE ile hareketler ve malzemeler de silinir (iç içe silmede stok kontrolü atlanır)
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftMat = siteIds.length ? await svc.from("materials").select("id").in("site_id", siteIds) : { data: [] };
  const leftMv = siteIds.length ? await svc.from("material_movements").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi (şantiye silinince stoklu kayıtlar da CASCADE ile gider)", !delErr && !left.data?.length && !leftSites.data?.length && !leftMat.data?.length && !leftMv.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
