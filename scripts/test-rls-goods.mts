/** RLS entegrasyon testi (Faz 3): parties + goods_entries. Geçici hesap/şantiye açar, gerçek oturumlarla dener,
 *  sonunda hepsini siler.  Çalıştırma: npm run test:rls:goods  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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

  // --- parties ---
  const pA = await c.partner.from("parties").insert({ site_id: siteA, name: `Firma A ${tag}`, category: "firma" }).select("id").single();
  check("ortak kendi şantiyesine firma ekleyebilir", !pA.error, pA.error?.message);
  const partyA = pA.data?.id as number;
  const pB = await c.owner2.from("parties").insert({ site_id: siteB, name: `Firma B ${tag}`, category: "nakliyeci" }).select("id").single();
  const partyB = pB.data?.id as number;

  const dup = await c.owner.from("parties").insert({ site_id: siteA, name: `firma a ${tag}` });
  check("aynı adla (büyük/küçük harf farkıyla) ikinci firma eklenemez", !!dup.error);
  check("viewer firma ekleyemez", !!(await c.viewer.from("parties").insert({ site_id: siteA, name: `V ${tag}` })).error);
  check("üye olmayan firma ekleyemez", !!(await c.outsider.from("parties").insert({ site_id: siteA, name: `X ${tag}` })).error);
  check("admin firma ekleyemez", !!(await c.admin.from("parties").insert({ site_id: siteA, name: `Adm ${tag}` })).error);
  check("başka şantiyenin sahibi bu şantiyeye firma ekleyemez", !!(await c.owner2.from("parties").insert({ site_id: siteA, name: `O2 ${tag}` })).error);
  check("geçersiz kategori reddedilir", !!(await c.owner.from("parties").insert({ site_id: siteA, name: `K ${tag}`, category: "hacker" })).error);

  const seeA = await c.viewer.from("parties").select("id").eq("site_id", siteA);
  check("viewer firmaları görebilir", seeA.data?.length === 1);
  check("üye olmayan firmaları göremez", (await c.outsider.from("parties").select("id").eq("site_id", siteA)).data?.length === 0);
  check("başka şantiyenin ortağı firmaları göremez", (await c.owner2.from("parties").select("id").eq("site_id", siteA)).data?.length === 0);
  check("admin firmaları görüntüleyebilir", (await c.admin.from("parties").select("id").in("site_id", siteIds)).data?.length === 2);
  check("firma site_id değiştirilemez", !!(await c.partner.from("parties").update({ site_id: siteB }).eq("id", partyA)).error);

  // --- goods_entries ---
  const base = { site_id: siteA, entry_date: "2026-09-26", document_type: "irsaliye", document_no: "IR-1", party_id: partyA, material_type: "Çimento", unit: "torba", quantity: 100, transport_cost: 1500 };

  const ins = await c.partner.from("goods_entries").insert({ ...base, created_by: ids.partner }).select("id").single();
  check("ortak irsaliye ekleyebilir", !ins.error, ins.error?.message);
  const entryId = ins.data?.id as number;
  const ins2 = await c.owner.from("goods_entries").insert({ ...base, document_type: "fis", document_no: null, party_id: null, created_by: ids.owner }).select("id").single();
  check("firmasız fiş girilebilir (party_id boş)", !ins2.error, ins2.error?.message);

  check("viewer irsaliye ekleyemez", !!(await c.viewer.from("goods_entries").insert({ ...base, created_by: ids.viewer })).error);
  check("üye olmayan irsaliye ekleyemez", !!(await c.outsider.from("goods_entries").insert({ ...base, created_by: ids.outsider })).error);
  check("admin irsaliye ekleyemez", !!(await c.admin.from("goods_entries").insert({ ...base, created_by: ids.admin })).error);
  check("başkası adına (created_by) irsaliye eklenemez", !!(await c.partner.from("goods_entries").insert({ ...base, created_by: ids.owner })).error);
  check("başka şantiyeye irsaliye eklenemez", !!(await c.partner.from("goods_entries").insert({ ...base, site_id: siteB, party_id: null, created_by: ids.partner })).error);
  check("başka şantiyenin firması bağlanamaz (bileşik FK)", !!(await c.owner2.from("goods_entries").insert({ ...base, site_id: siteB, party_id: partyA, created_by: ids.owner2 })).error);
  check("geçersiz belge türü reddedilir", !!(await c.partner.from("goods_entries").insert({ ...base, document_type: "makbuz", created_by: ids.partner })).error);
  check("negatif miktar reddedilir", !!(await c.partner.from("goods_entries").insert({ ...base, quantity: -5, created_by: ids.partner })).error);
  check("negatif nakliye tutarı reddedilir", !!(await c.partner.from("goods_entries").insert({ ...base, transport_cost: -1, created_by: ids.partner })).error);

  check("viewer irsaliyeleri görebilir", (await c.viewer.from("goods_entries").select("id").eq("site_id", siteA)).data?.length === 2);
  check("üye olmayan irsaliyeleri göremez", (await c.outsider.from("goods_entries").select("id").eq("site_id", siteA)).data?.length === 0);
  check("başka şantiyenin sahibi bu irsaliyeleri göremez", (await c.owner2.from("goods_entries").select("id").eq("site_id", siteA)).data?.length === 0);
  check("admin irsaliyeleri görüntüleyebilir", (await c.admin.from("goods_entries").select("id").eq("site_id", siteA)).data?.length === 2);

  const upd = await c.owner.from("goods_entries").update({ quantity: 120 }).eq("id", entryId).select("quantity");
  check("şantiye üyesi (owner) ortağın kaydını güncelleyebilir", upd.data?.length === 1 && Number(upd.data[0].quantity) === 120);
  check("viewer güncelleyemez", denied(await c.viewer.from("goods_entries").update({ quantity: 1 }).eq("id", entryId).select()));
  check("üye olmayan güncelleyemez", denied(await c.outsider.from("goods_entries").update({ quantity: 1 }).eq("id", entryId).select()));
  check("admin güncelleyemez", denied(await c.admin.from("goods_entries").update({ quantity: 1 }).eq("id", entryId).select()));
  check("kaydın site_id'si değiştirilemez", !!(await c.owner.from("goods_entries").update({ site_id: siteB }).eq("id", entryId)).error);
  check("kaydın created_by'ı değiştirilemez", !!(await c.owner.from("goods_entries").update({ created_by: ids.owner }).eq("id", entryId)).error);
  check("kayda başka şantiyenin firması bağlanamaz (güncellemede)", !!(await c.owner.from("goods_entries").update({ party_id: partyB }).eq("id", entryId)).error);

  check("firması olan irsaliye varken firma silinemez", !!(await c.owner.from("parties").delete().eq("id", partyA)).error);
  check("viewer silemez", denied(await c.viewer.from("goods_entries").delete().eq("id", entryId).select()));
  check("üye olmayan silemez", denied(await c.outsider.from("goods_entries").delete().eq("id", entryId).select()));
  check("admin silemez", denied(await c.admin.from("goods_entries").delete().eq("id", entryId).select()));
  check("ortak kaydı silebilir", (await c.partner.from("goods_entries").delete().eq("id", entryId).select()).data?.length === 1);

  const an = createClient(url, anon);
  check("anonim irsaliye okuyamaz", denied(await an.from("goods_entries").select("id")));
  check("anonim firma okuyamaz", denied(await an.from("parties").select("id")));
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  if (siteIds.length) await svc.from("sites").delete().in("id", siteIds); // parties/goods_entries CASCADE ile gider
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftParties = await svc.from("parties").select("id").like("name", `%${tag}`);
  check("test verisi temizlendi", !left.data?.length && !leftSites.data?.length && !leftParties.data?.length);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
