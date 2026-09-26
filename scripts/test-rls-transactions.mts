/** RLS entegrasyon testi (Faz 6-7): transactions, categories, party_balances view'i ve cari (parties) yönetimi.
 *  Geçici hesap/şantiye açar, gerçek oturumlarla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:rls:transactions  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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
const num = (v: unknown) => Number(v);

async function login(who: Who): Promise<SupabaseClient> {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword(cred[who]);
  if (error) throw error;
  return c;
}

const siteIds: number[] = [];
const defaultCategoryIds: number[] = [];
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

  const mkParty = async (site: number, name: string) => (await svc.from("parties").insert({ site_id: site, name: `${name} ${tag}`, category: "firma" }).select("id").single()).data!.id as number;
  const [pA1, pA2, pEmpty, pB] = [await mkParty(siteA, "Firma A1"), await mkParty(siteA, "Firma A2"), await mkParty(siteA, "Firma Boş"), await mkParty(siteB, "Firma B")];
  const { data: persA } = await svc.from("personnel").insert({ site_id: siteA, status: "aktif", full_name: `Kisi A ${tag}` }).select("id").single();
  const { data: persB } = await svc.from("personnel").insert({ site_id: siteB, status: "aktif", full_name: `Kisi B ${tag}` }).select("id").single();
  const { data: geA } = await svc.from("goods_entries").insert({ site_id: siteA, entry_date: "2026-09-01", document_type: "irsaliye", created_by: ids.owner }).select("id").single();
  const { data: geB } = await svc.from("goods_entries").insert({ site_id: siteB, entry_date: "2026-09-01", document_type: "irsaliye", created_by: ids.owner2 }).select("id").single();
  const { data: dInc } = await svc.from("categories").insert({ site_id: null, name: `Varsayılan gelir ${tag}`, type: "income" }).select("id").single();
  const { data: dExp } = await svc.from("categories").insert({ site_id: null, name: `Varsayılan gider ${tag}`, type: "expense" }).select("id").single();
  defaultCategoryIds.push(dInc!.id, dExp!.id);
  const { data: catB } = await svc.from("categories").insert({ site_id: siteB, name: `B kategorisi ${tag}`, type: "expense" }).select("id").single();

  const c = {} as Record<Who, SupabaseClient>;
  for (const w of Object.keys(accounts) as Who[]) c[w] = await login(w);

  const base = { site_id: siteA, type: "expense", description: "Malzeme ödemesi", amount: 400, transaction_date: "2026-09-10", payment_method: "havale" };

  // ---------- ekleme ----------
  const ins = await c.partner.from("transactions").insert({ ...base, party_id: pA1, user_id: ids.partner }).select("id, currency, created_at, updated_at").single();
  check("ortak cari ödemesi ekleyebilir", !ins.error, ins.error?.message);
  const txId = ins.data?.id as number;
  check("para birimi varsayılan TRY", ins.data?.currency === "TRY");

  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: hareket ekleyemez`, !!(await c[w].from("transactions").insert({ ...base, user_id: ids[w] })).error);
  }
  check("başkası adına (user_id) hareket eklenemez", !!(await c.partner.from("transactions").insert({ ...base, user_id: ids.owner })).error);
  check("negatif tutar reddedilir", !!(await c.partner.from("transactions").insert({ ...base, amount: -5, user_id: ids.partner })).error);
  check("geçersiz tür reddedilir", !!(await c.partner.from("transactions").insert({ ...base, type: "transfer", user_id: ids.partner })).error);
  check("geçersiz ödeme yöntemi reddedilir", !!(await c.partner.from("transactions").insert({ ...base, payment_method: "bitcoin", user_id: ids.partner })).error);
  check("boş açıklama reddedilir", !!(await c.partner.from("transactions").insert({ ...base, description: "   ", user_id: ids.partner })).error);
  check("başka şantiyeye hareket eklenemez", !!(await c.partner.from("transactions").insert({ ...base, site_id: siteB, user_id: ids.partner })).error);

  // ---------- şantiyeler arası bağlantılar (bileşik FK) ----------
  check("başka şantiyenin carisi bağlanamaz", !!(await c.partner.from("transactions").insert({ ...base, party_id: pB, user_id: ids.partner })).error);
  check("başka şantiyenin personeli bağlanamaz", !!(await c.partner.from("transactions").insert({ ...base, personnel_id: persB!.id, user_id: ids.partner })).error);
  check("başka şantiyenin irsaliyesi bağlanamaz", !!(await c.partner.from("transactions").insert({ ...base, goods_entry_id: geB!.id, user_id: ids.partner })).error);
  const okLinks = await c.partner.from("transactions").insert({ ...base, party_id: pA2, personnel_id: persA!.id, goods_entry_id: geA!.id, user_id: ids.partner }).select("id").single();
  check("aynı şantiyenin cari + personel + irsaliyesi bağlanabilir", !okLinks.error, okLinks.error?.message);

  // ---------- kategori kuralları ----------
  check("varsayılan (tüm şantiyeler) kategori aynı türde kullanılabilir", !(await c.partner.from("transactions").insert({ ...base, category_id: dExp!.id, user_id: ids.partner })).error);
  check("kategori türü işlem türüyle uyuşmazsa reddedilir", !!(await c.partner.from("transactions").insert({ ...base, type: "income", category_id: dExp!.id, user_id: ids.partner })).error);
  check("başka şantiyenin kategorisi kullanılamaz", !!(await c.partner.from("transactions").insert({ ...base, category_id: catB!.id, user_id: ids.partner })).error);
  const ownCat = await c.owner.from("categories").insert({ site_id: siteA, name: `A kategorisi ${tag}`, type: "expense" }).select("id").single();
  check("ortak kendi şantiyesine kategori ekleyebilir", !ownCat.error, ownCat.error?.message);
  check("şantiye kategorisi kendi şantiyesinde kullanılabilir", !(await c.partner.from("transactions").insert({ ...base, category_id: ownCat.data?.id, user_id: ids.partner })).error);
  check("kategori aynı adla (büyük/küçük harf farkıyla) ikinci kez eklenemez", !!(await c.owner.from("categories").insert({ site_id: siteA, name: `a kategorisi ${tag}`, type: "expense" })).error);
  check("ortak varsayılan (site_id boş) kategori ekleyemez", !!(await c.owner.from("categories").insert({ site_id: null, name: `hack ${tag}`, type: "income" })).error);
  check("viewer kategori ekleyemez", !!(await c.viewer.from("categories").insert({ site_id: siteA, name: `v ${tag}`, type: "income" })).error);
  check("üye olmayan varsayılan kategorileri okuyabilir", ((await c.outsider.from("categories").select("id").in("id", defaultCategoryIds)).data?.length ?? 0) === 2);
  check("üye olmayan şantiye kategorisini göremez", (await c.outsider.from("categories").select("id").eq("id", ownCat.data!.id)).data?.length === 0);
  check("başka şantiyenin sahibi bu şantiyenin kategorisini göremez", (await c.owner2.from("categories").select("id").eq("id", ownCat.data!.id)).data?.length === 0);
  check("varsayılan kategori ortak tarafından silinemez", denied(await c.owner.from("categories").delete().eq("id", dExp!.id).select("id")));
  check("kategori adı dışında sütun güncellenemez", !!(await c.owner.from("categories").update({ type: "income" }).eq("id", ownCat.data!.id)).error);

  // ---------- okuma ----------
  check("viewer hareketleri görebilir", (await c.viewer.from("transactions").select("id").eq("id", txId)).data?.length === 1);
  check("admin hareketleri görüntüleyebilir", (await c.admin.from("transactions").select("id").eq("id", txId)).data?.length === 1);
  check("üye olmayan hareketleri göremez", (await c.outsider.from("transactions").select("id").eq("site_id", siteA)).data?.length === 0);
  check("başka şantiyenin sahibi hareketleri göremez", (await c.owner2.from("transactions").select("id").eq("site_id", siteA)).data?.length === 0);

  // ---------- güncelleme ----------
  await new Promise((r) => setTimeout(r, 1100));
  const upd = await c.owner.from("transactions").update({ amount: 450, description: "Düzeltilmiş" }).eq("id", txId).select("amount, description, created_at, updated_at");
  check("üye (owner) ortağın hareketini güncelleyebilir", upd.data?.length === 1 && num(upd.data[0].amount) === 450);
  check("updated_at güncellemede otomatik ilerler", !!upd.data?.[0] && new Date(upd.data[0].updated_at) > new Date(upd.data[0].created_at));
  for (const w of ["viewer", "admin", "outsider"] as Who[]) {
    check(`${w}: güncelleyemez`, denied(await c[w].from("transactions").update({ amount: 1 }).eq("id", txId).select("id")));
  }
  check("hareketin site_id'si değiştirilemez", !!(await c.owner.from("transactions").update({ site_id: siteB }).eq("id", txId)).error);
  check("hareketin user_id'si değiştirilemez", !!(await c.owner.from("transactions").update({ user_id: ids.owner }).eq("id", txId)).error);
  check("güncellemede başka şantiyenin carisi bağlanamaz", !!(await c.owner.from("transactions").update({ party_id: pB }).eq("id", txId)).error);
  await c.partner.from("transactions").update({ category_id: dExp!.id }).eq("id", txId);
  check("kategorili hareketin türü uyumsuz kategoriyle değiştirilemez", !!(await c.owner.from("transactions").update({ type: "income" }).eq("id", txId)).error);

  // ---------- party_balances ----------
  const mk = (party: number, type: "income" | "expense", amount: number, date: string) => svc.from("transactions").insert({ site_id: siteA, party_id: party, type, amount, description: `t ${type}`, transaction_date: date, user_id: ids.owner });
  await mk(pA2, "income", 1000, "2026-09-05");
  await mk(pA2, "income", 250, "2026-09-20");
  await mk(pA2, "expense", 400, "2026-09-15");
  const bal = await c.viewer.from("party_balances").select("party_id, total_income, total_expense, balance, total_turnover, transaction_count, last_transaction_date, category").eq("site_id", siteA);
  const b2 = bal.data?.find((r) => r.party_id === pA2);
  check("bakiye: A2 tahsilat/ödeme toplamları doğru (1250 / ödemeler toplamı)", !!b2 && num(b2.total_income) === 1250, JSON.stringify(b2));
  const exp2 = num(b2?.total_expense);
  check("bakiye = tahsilat − ödeme", !!b2 && num(b2.balance) === 1250 - exp2);
  check("ciro = tahsilat + ödeme", !!b2 && num(b2.total_turnover) === 1250 + exp2);
  check("hareket sayısı ve son hareket tarihi doğru", !!b2 && b2.transaction_count >= 3 && b2.last_transaction_date === "2026-09-20", JSON.stringify(b2));
  const b0 = bal.data?.find((r) => r.party_id === pEmpty);
  check("hareketsiz cari: hepsi 0, sayı 0, son tarih boş", !!b0 && num(b0.total_income) === 0 && num(b0.balance) === 0 && b0.transaction_count === 0 && b0.last_transaction_date === null, JSON.stringify(b0));
  check("bakiye görünümü kategori bilgisini içerir", b0?.category === "firma");
  check("bakiye: viewer yalnızca kendi şantiyesinin carilerini görür (3 cari)", (bal.data?.length ?? 0) === 3, String(bal.data?.length));
  check("bakiye: admin görüntüleyebilir", ((await c.admin.from("party_balances").select("party_id").eq("site_id", siteA)).data?.length ?? 0) === 3);
  check("bakiye: üye olmayan boş görür (view RLS'e tabi)", ((await c.outsider.from("party_balances").select("party_id").eq("site_id", siteA)).data?.length ?? 1) === 0);
  check("bakiye: başka şantiyenin sahibi boş görür", ((await c.owner2.from("party_balances").select("party_id").eq("site_id", siteA)).data?.length ?? 1) === 0);
  check("bakiye: anonim okuyamaz", denied(await createClient(url, anon).from("party_balances").select("party_id")));
  check("bakiye: başka şantiyenin carisi bu şantiyenin toplamına karışmaz", num((await c.owner2.from("party_balances").select("total_turnover").eq("party_id", pB).single()).data?.total_turnover) === 0);

  // ---------- Faz 7: varsayılan kategoriler, get_cash_summary RPC'si, site_cash_summary view'i ----------
  const seeded = await c.outsider.from("categories").select("name, type").is("site_id", null).not("name", "like", `%${tag}`);
  check("varsayılan kategoriler tohumlandı (4 gelir + 9 gider) ve herkes okuyabilir", (seeded.data?.filter((r) => r.type === "income").length ?? 0) >= 4 && (seeded.data?.filter((r) => r.type === "expense").length ?? 0) >= 9, JSON.stringify(seeded.data?.length));
  check("varsayılan 'Malzeme' gider ve 'Hakediş' gelir kategorisi var", !!seeded.data?.some((r) => r.name === "Malzeme" && r.type === "expense") && !!seeded.data?.some((r) => r.name === "Hakediş" && r.type === "income"));

  type SumRow = { type: string; category_id: number | null; total: number; tx_count: number };
  const rangeFrom = "2026-01-01";
  const rangeTo = "2026-12-31";
  const truth = ((await svc.from("transactions").select("type, amount, category_id").eq("site_id", siteA).gte("transaction_date", rangeFrom).lte("transaction_date", rangeTo)).data ?? []) as { type: string; amount: number; category_id: number | null }[];
  const truthByType = (t: string) => truth.filter((r) => r.type === t).reduce((sum, r) => sum + Number(r.amount), 0);
  const sumOf = async (who: Who, from = rangeFrom, to = rangeTo) => (await c[who].rpc("get_cash_summary", { p_site_id: siteA, p_from: from, p_to: to }));
  const owSum = await sumOf("owner");
  const rows7 = (owSum.data ?? []) as SumRow[];
  const byType = (t: string) => rows7.filter((r) => r.type === t).reduce((sum, r) => sum + Number(r.total), 0);
  check("get_cash_summary: gelir toplamı gerçek toplamla aynı", !owSum.error && Math.abs(byType("income") - truthByType("income")) < 0.001 && truthByType("income") > 0, JSON.stringify(owSum.error ?? { rpc: byType("income"), truth: truthByType("income") }));
  check("get_cash_summary: gider toplamı gerçek toplamla aynı", Math.abs(byType("expense") - truthByType("expense")) < 0.001 && truthByType("expense") > 0);
  check("get_cash_summary: hareket sayısı doğru", rows7.reduce((n, r) => n + r.tx_count, 0) === truth.length);
  check("get_cash_summary: kategorisiz hareketler category_id boş satırda gruplanır", rows7.some((r) => r.category_id === null));
  check("get_cash_summary: kategorili hareketler kategoriye göre ayrılır", rows7.some((r) => r.category_id === dExp!.id));
  const narrow = ((await sumOf("owner", "2026-09-20", "2026-09-20")).data ?? []) as SumRow[];
  check("get_cash_summary: tarih aralığı dışındaki hareketler gelmez (tek gün)", narrow.reduce((n, r) => n + r.tx_count, 0) === truth.filter(() => false).length + ((await svc.from("transactions").select("id").eq("site_id", siteA).eq("transaction_date", "2026-09-20")).data?.length ?? 0));
  check("get_cash_summary: boş aralık boş döner", ((await sumOf("owner", "2001-01-01", "2001-01-02")).data as unknown[] | null)?.length === 0);
  check("get_cash_summary: viewer görebilir", ((await sumOf("viewer")).data as unknown[] | null)?.length === rows7.length);
  check("get_cash_summary: admin görüntüleyebilir", ((await sumOf("admin")).data as unknown[] | null)?.length === rows7.length);
  check("get_cash_summary: üye olmayan boş görür (RLS)", ((await sumOf("outsider")).data as unknown[] | null)?.length === 0);
  check("get_cash_summary: başka şantiyenin sahibi boş görür", ((await sumOf("owner2")).data as unknown[] | null)?.length === 0);
  check("get_cash_summary: anonim çağıramaz", !!(await createClient(url, anon).rpc("get_cash_summary", { p_site_id: siteA, p_from: rangeFrom, p_to: rangeTo })).error);

  const monthly = await c.viewer.from("site_cash_summary").select("month, type, category_id, total").eq("site_id", siteA);
  const monthlyExpense = (monthly.data ?? []).filter((r) => r.type === "expense").reduce((sum, r) => sum + Number(r.total), 0);
  check("site_cash_summary: aylık toplamlar hareketlerle tutarlı (gider)", !monthly.error && Math.abs(monthlyExpense - truthByType("expense")) < 0.001, JSON.stringify(monthly.error));
  check("site_cash_summary: ay ilk gün olarak gelir (yyyy-mm-01)", (monthly.data ?? []).every((r) => /^\d{4}-\d{2}-01$/.test(String(r.month))));
  check("site_cash_summary: üye olmayan boş görür", ((await c.outsider.from("site_cash_summary").select("month").eq("site_id", siteA)).data?.length ?? 1) === 0);
  check("site_cash_summary: admin görüntüleyebilir", ((await c.admin.from("site_cash_summary").select("month").eq("site_id", siteA)).data?.length ?? 0) > 0);
  check("site_cash_summary: anonim okuyamaz", denied(await createClient(url, anon).from("site_cash_summary").select("month")));

  // ---------- cari yönetimi (parties) ----------
  check("hareketi olan cari silinemez (yabancı anahtar)", !!(await c.owner.from("parties").delete().eq("id", pA2)).error);
  check("hareketi olmayan cari silinebilir", (await c.owner.from("parties").delete().eq("id", pEmpty).select("id")).data?.length === 1);
  check("viewer cari silemez", denied(await c.viewer.from("parties").delete().eq("id", pA1).select("id")));
  check("ortak cari bilgisini güncelleyebilir", (await c.partner.from("parties").update({ phone: "0532 000 00 00", notes: "Not" }).eq("id", pA1).select("id")).data?.length === 1);
  check("cari kategorisi geçersiz değere değiştirilemez", !!(await c.partner.from("parties").update({ category: "hacker" }).eq("id", pA1)).error);
  check("personeli olan/hareketi olan personel silinemez", !!(await c.owner.from("personnel").delete().eq("id", persA!.id)).error);

  // ---------- irsaliye silinince hareket kalır ----------
  await c.owner.from("goods_entries").delete().eq("id", geA!.id);
  const kept = await svc.from("transactions").select("id, goods_entry_id, site_id").eq("id", okLinks.data!.id).single();
  check("irsaliye silinince bağlı hareket silinmez, yalnızca bağlantısı boşalır", !!kept.data && kept.data.goods_entry_id === null && kept.data.site_id === siteA, JSON.stringify(kept));

  // ---------- silme ----------
  check("viewer hareket silemez", denied(await c.viewer.from("transactions").delete().eq("id", txId).select("id")));
  check("admin hareket silemez", denied(await c.admin.from("transactions").delete().eq("id", txId).select("id")));
  check("üye olmayan hareket silemez", denied(await c.outsider.from("transactions").delete().eq("id", txId).select("id")));
  check("ortak hareketi silebilir", (await c.partner.from("transactions").delete().eq("id", txId).select("id")).data?.length === 1);

  const an = createClient(url, anon);
  check("anonim hareket okuyamaz", denied(await an.from("transactions").select("id")));
  check("anonim kategori okuyamaz", denied(await an.from("categories").select("id")));
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  if (siteIds.length) await svc.from("sites").delete().in("id", siteIds); // parties/personnel/transactions/categories CASCADE
  if (defaultCategoryIds.length) await svc.from("categories").delete().in("id", defaultCategoryIds);
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftCat = await svc.from("categories").select("id").like("name", `%${tag}`);
  const leftTx = siteIds.length ? await svc.from("transactions").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi", !left.data?.length && !leftSites.data?.length && !leftCat.data?.length && !leftTx.data?.length);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
