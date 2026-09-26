/** RLS entegrasyon testi: geçici hesaplar açar, gerçek oturumlarla politikaları dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls   (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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
  admin: { email: `t-admin-${tag}@example.test`, password: pw(), role: "admin", name: `Yonetici ${tag}` },
  p1: { email: `t-p1-${tag}@example.test`, password: pw(), role: "partner", name: `Ortak Bir ${tag}` },
  p2: { email: `t-p2-${tag}@example.test`, password: pw(), role: "partner", name: `Ortak Iki ${tag}` },
  p3: { email: `t-p3-${tag}@example.test`, password: pw(), role: "partner", name: `Ortak Uc ${tag}` },
} as const;
type Who = keyof typeof accounts;
const ids = {} as Record<Who, string>;
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);
const blocked = (r: { error: unknown; data?: unknown }) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);

async function login(who: Who): Promise<SupabaseClient> {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: accounts[who].email, password: accounts[who].password });
  if (error) throw error;
  return c;
}

const siteIds: number[] = [];
try {
  for (const w of Object.keys(accounts) as Who[]) {
    const a = accounts[w];
    const { data, error } = await svc.auth.admin.createUser({ email: a.email, password: a.password, email_confirm: true });
    if (error) throw error;
    ids[w] = data.user.id;
    const { error: e2 } = await svc.from("users").insert({ id: data.user.id, full_name: a.name, email: a.email, role: a.role, must_change_password: false });
    if (e2) throw e2;
  }
  const [admin, p1, p2, p3] = await Promise.all([login("admin"), login("p1"), login("p2"), login("p3")]);

  // --- Ortak 1 şantiye oluşturur (RPC): otomatik owner ---
  const created = await p1.rpc("create_site", { p_name: `Site ${tag}`, p_address: "Adres", p_start_date: "2026-09-01" });
  check("ortak1 create_site ile şantiye oluşturabildi", !created.error && typeof created.data === "number", created.error?.message);
  const siteId = created.data as number;
  siteIds.push(siteId);

  const own = await p1.from("site_members").select("user_id, role").eq("site_id", siteId);
  check("oluşturan otomatik owner oldu", own.data?.length === 1 && own.data[0].user_id === ids.p1 && own.data[0].role === "owner", JSON.stringify(own.data));
  const site = await svc.from("sites").select("created_by").eq("id", siteId).single();
  check("created_by = oluşturan kullanıcı", site.data?.created_by === ids.p1);

  // --- Arama: yalnızca owner, yalnızca ortaklar ---
  const s1 = await p1.rpc("search_users_for_site", { p_site_id: siteId, p_query: `Ortak Iki ${tag}` });
  check("owner, sistemdeki başka ortağı arayıp bulur", (s1.data as { id: string }[] | null)?.some((u) => u.id === ids.p2) === true, JSON.stringify(s1));
  const sAdmin = await p1.rpc("search_users_for_site", { p_site_id: siteId, p_query: `Yonetici ${tag}` });
  check("arama admin hesaplarını döndürmez", (sAdmin.data as unknown[] | null)?.length === 0, JSON.stringify(sAdmin.data));
  const sOther = await p2.rpc("search_users_for_site", { p_site_id: siteId, p_query: "Ortak" });
  check("owner olmayan ortak arama yapamaz", !!sOther.error);
  const sSelf = await p1.rpc("search_users_for_site", { p_site_id: siteId, p_query: `Ortak Bir ${tag}` });
  check("arama sonucunda mevcut üyeler (kendisi) yok", (sSelf.data as unknown[] | null)?.length === 0);

  // --- Ortak 1, ortak 2'yi ekler ---
  const add = await p1.from("site_members").insert({ site_id: siteId, user_id: ids.p2, role: "partner" });
  check("owner mevcut bir ortağı partner olarak ekleyebildi", !add.error, add.error?.message);
  const p2sees = await p2.from("sites").select("id").eq("id", siteId);
  check("eklenen ortak şantiyeyi artık görüyor", p2sees.data?.length === 1);

  // --- Yetki sınırları ---
  const addByMember = await p2.from("site_members").insert({ site_id: siteId, user_id: ids.p3, role: "partner" });
  check("owner olmayan üye başkasını ekleyemez", !!addByMember.error);
  const addOwnerRole = await p1.from("site_members").insert({ site_id: siteId, user_id: ids.p3, role: "owner" });
  check("owner başkasına 'owner' rolü veremez", !!addOwnerRole.error);
  const addAdmin = await p1.from("site_members").insert({ site_id: siteId, user_id: ids.admin, role: "partner" });
  check("admin hesabı şantiyeye üye yapılamaz", !!addAdmin.error);
  const selfJoin = await p3.from("site_members").insert({ site_id: siteId, user_id: ids.p3, role: "owner" });
  check("başkası kendini mevcut şantiyeye owner ekleyemez", !!selfJoin.error);
  const selfJoin2 = await p3.from("site_members").insert({ site_id: siteId, user_id: ids.p3, role: "partner" });
  check("başkası kendini mevcut şantiyeye üye ekleyemez", !!selfJoin2.error);
  const p3sees = await p3.from("sites").select("id").eq("id", siteId);
  check("üye olmayan ortak şantiyeyi göremez", p3sees.data?.length === 0);
  const p2del = await p2.from("site_members").delete().eq("site_id", siteId).eq("user_id", ids.p1).select();
  check("üye, owner'ı çıkaramaz", blocked(p2del));
  const p1delOwner = await p1.from("site_members").delete().eq("site_id", siteId).eq("user_id", ids.p1).select();
  check("owner kendini (owner satırını) silemez", blocked(p1delOwner));
  const forged = await p3.from("sites").insert({ name: "sahte", created_by: ids.p1 }).select();
  check("başkası adına (created_by) şantiye eklenemez", !!forged.error);
  const upd = await p2.from("sites").update({ name: "ele geçirildi" }).eq("id", siteId).select();
  check("owner olmayan üye şantiyeyi güncelleyemez", blocked(upd));
  const updBy = await p1.from("sites").update({ created_by: ids.p3 }).eq("id", siteId).select();
  check("owner created_by'ı değiştiremez", !!updBy.error);
  const p1upd = await p1.from("sites").update({ name: `Site ${tag} (yeni ad)` }).eq("id", siteId).select();
  check("owner şantiyeyi güncelleyebilir", p1upd.data?.length === 1);

  const p1del = await p1.from("site_members").delete().eq("site_id", siteId).eq("user_id", ids.p2).select();
  check("owner, ortağı şantiyeden çıkarabilir", p1del.data?.length === 1);
  const p2after = await p2.from("sites").select("id").eq("id", siteId);
  check("çıkarılan ortak şantiyeyi artık göremez", p2after.data?.length === 0);

  // --- Admin: oluşturamaz / üye ekleyemez, sadece görür ---
  const aRpc = await admin.rpc("create_site", { p_name: `Admin site ${tag}` });
  check("admin create_site ile şantiye oluşturamaz", !!aRpc.error, aRpc.error?.message);
  const aIns = await admin.from("sites").insert({ name: `Admin site 2 ${tag}`, created_by: ids.admin }).select();
  check("admin doğrudan şantiye ekleyemez", !!aIns.error);
  const aMem = await admin.from("site_members").insert({ site_id: siteId, user_id: ids.admin, role: "owner" });
  check("admin kendini şantiyeye üye yapamaz", !!aMem.error);
  const aMem2 = await admin.from("site_members").insert({ site_id: siteId, user_id: ids.p3, role: "partner" });
  check("admin site_members'a satır ekleyemez", !!aMem2.error);
  const aUpd = await admin.from("sites").update({ name: "admin değiştirdi" }).eq("id", siteId).select();
  check("admin şantiyeyi güncelleyemez", blocked(aUpd));
  const aDel = await admin.from("sites").delete().eq("id", siteId).select();
  check("admin şantiyeyi silemez", blocked(aDel));
  const aSee = await admin.from("sites").select("id").eq("id", siteId);
  check("admin tüm şantiyeleri görüntüleyebilir (salt okunur)", aSee.data?.length === 1);
  const aSeeMem = await admin.from("site_members").select("id").eq("site_id", siteId);
  check("admin üyeleri görüntüleyebilir", (aSeeMem.data?.length ?? 0) >= 1);
  const aSearch = await admin.rpc("search_users_for_site", { p_site_id: siteId, p_query: "Ortak" });
  check("admin ortak arama fonksiyonunu kullanamaz", !!aSearch.error);

  const an = createClient(url, anon);
  const anCreate = await an.rpc("create_site", { p_name: "anon" });
  check("anonim create_site çağıramaz", !!anCreate.error);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  if (siteIds.length) await svc.from("sites").delete().in("id", siteIds);
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `%${tag}%`);
  check("test verisi temizlendi", (left.data?.length ?? 1) === 0 && (leftSites.data?.length ?? 1) === 0);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
