/** RLS/doğruluk testi: progress_payments (hakediş), invoices (fatura), get_billing_summary ve get_billing_owners RPC'leri.
 *  Her ortağın kayıtları kendine özeldir; admin hepsini salt okur. Geçici hesap/şantiye açar, sonunda siler.
 *  Çalıştırma: npm run test:rls:billing  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
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

  const pay = (who: Who, over: Record<string, unknown> = {}) => ({ site_id: siteA, payment_date: "2026-09-10", description: "1. hakediş", amount: 10000, created_by: ids[who], ...over });
  const inv = (who: Who, over: Record<string, unknown> = {}) => ({ site_id: siteA, invoice_date: "2026-09-15", invoice_type: "malzeme", description: "Beton malzemesi", amount: 6000, created_by: ids[who], ...over });

  // ---------- hakediş ekleme ----------
  const p1 = await c.owner.from("progress_payments").insert(pay("owner")).select("id").single();
  check("sahip hakediş ekleyebilir", !p1.error, p1.error?.message);
  check("sahip ikinci hakediş (5000)", !(await c.owner.from("progress_payments").insert(pay("owner", { amount: 5000, description: "2. hakediş" }))).error);
  const p3 = await c.partner.from("progress_payments").insert(pay("partner", { amount: 20000 })).select("id").single();
  check("ortak kendi hakedişini ekleyebilir (20000)", !p3.error, p3.error?.message);
  check("açıklamasız hakediş serbest", !(await c.owner.from("progress_payments").insert(pay("owner", { description: null, amount: 1 }))).error);
  check("sıfır hakediş reddedilir", !!(await c.owner.from("progress_payments").insert(pay("owner", { amount: 0 }))).error);
  check("negatif hakediş reddedilir", !!(await c.owner.from("progress_payments").insert(pay("owner", { amount: -5 }))).error);
  check("tarihsiz hakediş reddedilir", !!(await c.owner.from("progress_payments").insert(pay("owner", { payment_date: null }))).error);
  check("başkası adına hakediş yazılamaz", !!(await c.partner.from("progress_payments").insert(pay("owner"))).error);
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: hakediş ekleyemez`, !!(await c[w].from("progress_payments").insert(pay(w))).error);
  }
  check("anonim hakediş ekleyemez", !!(await createClient(url, anon).from("progress_payments").insert(pay("owner"))).error);
  // bu satır silinecek (1 TL'lik hakediş): toplamı bozmasın
  await c.owner.from("progress_payments").delete().eq("amount", 1).eq("site_id", siteA);

  // ---------- fatura ekleme ----------
  const i1 = await c.owner.from("invoices").insert(inv("owner")).select("id").single();
  check("sahip fatura ekleyebilir", !i1.error, i1.error?.message);
  const i2 = await c.owner.from("invoices").insert(inv("owner", { invoice_type: "nakliyat", description: "Beton nakliyesi", amount: 2500.5, invoice_no: "ABC-123" })).select("id").single();
  check("sahip nakliyat faturası (2500,50, no ile)", !i2.error, i2.error?.message);
  const i3 = await c.partner.from("invoices").insert(inv("partner", { invoice_type: "yakit", description: "Yakıt", amount: 20000 })).select("id").single();
  check("ortak kendi faturasını ekleyebilir (yakıt 20000)", !i3.error, i3.error?.message);
  for (const t of ["iscilik", "kira", "diger"]) {
    check(`fatura türü '${t}' kabul edilir`, !(await c.partner.from("invoices").insert(inv("partner", { invoice_type: t, amount: 1 }))).error);
  }
  await c.partner.from("invoices").delete().eq("amount", 1).eq("site_id", siteA);
  check("geçersiz fatura türü reddedilir", !!(await c.owner.from("invoices").insert(inv("owner", { invoice_type: "eglence" }))).error);
  check("türsüz fatura reddedilir", !!(await c.owner.from("invoices").insert(inv("owner", { invoice_type: null }))).error);
  check("açıklamasız fatura reddedilir", !!(await c.owner.from("invoices").insert(inv("owner", { description: " " }))).error);
  check("sıfır tutarlı fatura reddedilir", !!(await c.owner.from("invoices").insert(inv("owner", { amount: 0 }))).error);
  check("negatif tutarlı fatura reddedilir", !!(await c.owner.from("invoices").insert(inv("owner", { amount: -1 }))).error);
  check("başkası adına fatura yazılamaz", !!(await c.partner.from("invoices").insert(inv("owner"))).error);
  for (const w of ["viewer", "admin", "outsider", "owner2"] as Who[]) {
    check(`${w}: fatura ekleyemez`, !!(await c[w].from("invoices").insert(inv(w))).error);
  }
  await c.owner2.from("progress_payments").insert(pay("owner2", { site_id: siteB, amount: 777777 }));

  // ---------- okuma / izolasyon ----------
  const count = async (who: Who, table: string, site = siteA) => ((await c[who].from(table).select("id").eq("site_id", site)).data ?? []).length;
  check("sahip yalnızca kendi 2 hakedişini görür", (await count("owner", "progress_payments")) === 2);
  check("ortak yalnızca kendi 1 hakedişini görür", (await count("partner", "progress_payments")) === 1);
  check("sahip yalnızca kendi 2 faturasını görür", (await count("owner", "invoices")) === 2);
  check("ortak yalnızca kendi 1 faturasını görür", (await count("partner", "invoices")) === 1);
  check("admin tüm hakedişleri görür (3)", (await count("admin", "progress_payments")) === 3);
  check("admin tüm faturaları görür (3)", (await count("admin", "invoices")) === 3);
  check("viewer hiçbir kayıt göremez", (await count("viewer", "progress_payments")) === 0 && (await count("viewer", "invoices")) === 0);
  check("üye olmayan hiçbir kayıt göremez", (await count("outsider", "progress_payments")) === 0 && (await count("outsider", "invoices")) === 0);
  check("başka şantiyenin sahibi A'yı göremez", (await count("owner2", "progress_payments")) === 0 && (await count("owner2", "invoices")) === 0);
  check("A'nın sahibi B şantiyesini göremez", (await count("owner", "progress_payments", siteB)) === 0);
  check("ortak, sahibin hakedişini göremez", ((await c.partner.from("progress_payments").select("id").eq("id", p1.data!.id)).data ?? []).length === 0);
  check("anonim okuyamaz", denied(await createClient(url, anon).from("progress_payments").select("id")) && denied(await createClient(url, anon).from("invoices").select("id")));

  // ---------- güncelleme / silme ----------
  check("sahip kendi hakedişini güncelleyebilir", (await c.owner.from("progress_payments").update({ amount: 12000 }).eq("id", p1.data!.id).select("id")).data?.length === 1);
  await c.owner.from("progress_payments").update({ amount: 10000 }).eq("id", p1.data!.id);
  check("ortak başkasının hakedişini güncelleyemez", denied(await c.partner.from("progress_payments").update({ amount: 1 }).eq("id", p1.data!.id).select("id")));
  check("admin hakediş güncelleyemez", denied(await c.admin.from("progress_payments").update({ amount: 1 }).eq("id", p1.data!.id).select("id")));
  check("viewer hakediş güncelleyemez", denied(await c.viewer.from("progress_payments").update({ amount: 1 }).eq("id", p1.data!.id).select("id")));
  check("hakedişin şantiyesi (site_id) değiştirilemez", !!(await c.owner.from("progress_payments").update({ site_id: siteB }).eq("id", p1.data!.id)).error);
  check("hakedişin sahibi (created_by) değiştirilemez", !!(await c.owner.from("progress_payments").update({ created_by: ids.partner }).eq("id", p1.data!.id)).error);
  check("sahip fatura türünü ve tutarını güncelleyebilir", (await c.owner.from("invoices").update({ invoice_type: "diger", amount: 6001 }).eq("id", i1.data!.id).select("id")).data?.length === 1);
  await c.owner.from("invoices").update({ invoice_type: "malzeme", amount: 6000 }).eq("id", i1.data!.id);
  check("ortak başkasının faturasını güncelleyemez", denied(await c.partner.from("invoices").update({ description: "ele geçirme" }).eq("id", i1.data!.id).select("id")));
  check("admin fatura güncelleyemez", denied(await c.admin.from("invoices").update({ description: "x yy" }).eq("id", i1.data!.id).select("id")));
  check("faturanın sahibi (created_by) değiştirilemez", !!(await c.owner.from("invoices").update({ created_by: ids.partner }).eq("id", i1.data!.id)).error);
  check("ortak başkasının hakedişini silemez", denied(await c.partner.from("progress_payments").delete().eq("id", p1.data!.id).select("id")));
  check("ortak başkasının faturasını silemez", denied(await c.partner.from("invoices").delete().eq("id", i1.data!.id).select("id")));
  check("admin hakediş/fatura silemez", denied(await c.admin.from("progress_payments").delete().eq("id", p1.data!.id).select("id")) && denied(await c.admin.from("invoices").delete().eq("id", i1.data!.id).select("id")));
  check("viewer silemez", denied(await c.viewer.from("invoices").delete().eq("id", i1.data!.id).select("id")));

  // ---------- özet RPC: hakediş − fatura ----------
  // sahip: hakediş 15000 (2 adet); fatura malzeme 6000 + nakliyat 2500,50 = 8500,50 → kalan 6499,50
  const sum = await c.owner.rpc("get_billing_summary", { p_site_id: siteA, p_owner: ids.owner });
  const rows = (sum.data as { kind: string; invoice_type: string | null; entry_count: number; total: string }[]) ?? [];
  const h = rows.find((r) => r.kind === "hakedis");
  const f = rows.filter((r) => r.kind === "fatura");
  check("özet (sahip): toplam hakediş 15000, 2 adet", Number(h?.total) === 15000 && h?.entry_count === 2, JSON.stringify(rows));
  check("özet (sahip): fatura türe göre — malzeme 6000, nakliyat 2500,50", f.length === 2 && Number(f.find((r) => r.invoice_type === "malzeme")?.total) === 6000 && Number(f.find((r) => r.invoice_type === "nakliyat")?.total) === 2500.5, JSON.stringify(f));
  const fatura = f.reduce((s, r) => s + Number(r.total), 0);
  check("özet (sahip): kalan fatura = 15000 − 8500,50 = 6499,50", Math.round((Number(h?.total) - fatura) * 100) === 649950, String(fatura));
  const sumP = await c.partner.rpc("get_billing_summary", { p_site_id: siteA, p_owner: ids.partner });
  const rp = (sumP.data as { kind: string; total: string }[]) ?? [];
  check("özet (ortak): hakediş 20000, fatura 20000 → denk (kalan 0)", Number(rp.find((r) => r.kind === "hakedis")?.total) === 20000 && rp.filter((r) => r.kind === "fatura").reduce((s, r) => s + Number(r.total), 0) === 20000, JSON.stringify(rp));
  const spy = await c.partner.rpc("get_billing_summary", { p_site_id: siteA, p_owner: ids.owner });
  check("ortak, sahibin özetini göremez (hakediş 0, fatura yok)", Number((spy.data as { kind: string; total: string }[])?.find((r) => r.kind === "hakedis")?.total) === 0 && !(spy.data as { kind: string }[])?.some((r) => r.kind === "fatura"), JSON.stringify(spy.data));
  const spyAdmin = await c.admin.rpc("get_billing_summary", { p_site_id: siteA, p_owner: ids.owner });
  check("admin sahibin özetini görebilir (15000)", Number((spyAdmin.data as { kind: string; total: string }[])?.find((r) => r.kind === "hakedis")?.total) === 15000);
  const spyOut = await c.outsider.rpc("get_billing_summary", { p_site_id: siteA, p_owner: ids.owner });
  check("üye olmayan özet göremez", Number((spyOut.data as { kind: string; total: string }[])?.find((r) => r.kind === "hakedis")?.total) === 0 && !(spyOut.data as { kind: string }[])?.some((r) => r.kind === "fatura"));
  const spyB = await c.owner2.rpc("get_billing_summary", { p_site_id: siteA, p_owner: ids.owner });
  check("başka şantiyenin sahibi A özetini göremez", Number((spyB.data as { kind: string; total: string }[])?.find((r) => r.kind === "hakedis")?.total) === 0);
  check("B şantiyesinin hakedişi (777777) A'nın özetine sızmaz", !JSON.stringify(sum.data).includes("777777"));
  check("anonim özet çağıramaz", !!(await createClient(url, anon).rpc("get_billing_summary", { p_site_id: siteA, p_owner: ids.owner })).error);

  // ---------- ortak listesi RPC ----------
  const ownersAdmin = ((await c.admin.rpc("get_billing_owners", { p_site_id: siteA })).data as { owner_id: string; full_name: string }[]) ?? [];
  check("admin: kaydı olan 2 ortağı görür (isimle)", ownersAdmin.length === 2 && ownersAdmin.some((o) => o.owner_id === ids.owner) && ownersAdmin.some((o) => o.owner_id === ids.partner && o.full_name === `T partner ${tag}`), JSON.stringify(ownersAdmin));
  const ownersP = ((await c.partner.rpc("get_billing_owners", { p_site_id: siteA })).data as { owner_id: string }[]) ?? [];
  check("ortak: yalnızca kendini görür", ownersP.length === 1 && ownersP[0].owner_id === ids.partner, JSON.stringify(ownersP));
  check("üye olmayan: boş liste", (((await c.outsider.rpc("get_billing_owners", { p_site_id: siteA })).data as unknown[]) ?? []).length === 0);
  check("anonim ortak listesi çağıramaz", !!(await createClient(url, anon).rpc("get_billing_owners", { p_site_id: siteA })).error);

  // ---------- silme ----------
  check("sahip kendi hakedişini silebilir", (await c.owner.from("progress_payments").delete().eq("id", p1.data!.id).select("id")).data?.length === 1);
  check("ortak kendi faturasını silebilir", (await c.partner.from("invoices").delete().eq("id", i3.data!.id).select("id")).data?.length === 1);
  const after = await c.partner.rpc("get_billing_summary", { p_site_id: siteA, p_owner: ids.partner });
  check("fatura silince ortağın kalan faturası yeniden oluşur (20000 hakediş, 0 fatura)", !(after.data as { kind: string }[])?.some((r) => r.kind === "fatura") && Number((after.data as { kind: string; total: string }[])?.find((r) => r.kind === "hakedis")?.total) === 20000);

  // ---------- KDV ----------
  const kd = (over: Record<string, unknown>) => c.owner.from("invoices").insert(inv("owner", over)).select("id, amount, kdv_rate, kdv_amount, total_with_kdv").single();
  const legacy = await c.owner.from("invoices").select("kdv_rate, kdv_amount, total_with_kdv, amount").eq("id", i1.data!.id).single();
  check("eski/KDV'siz fatura: oran 0, KDV 0, toplam = tutar", Number(legacy.data?.kdv_rate) === 0 && Number(legacy.data?.kdv_amount) === 0 && Number(legacy.data?.total_with_kdv) === Number(legacy.data?.amount), JSON.stringify(legacy.data));
  const k1 = await kd({ amount: 1000, kdv_rate: 20, kdv_amount: 200, description: "KDV %20 hariç" });
  check("KDV hariç 1000 + %20 → KDV 200, toplam (KDV dahil) 1200 otomatik", !k1.error && Number(k1.data?.total_with_kdv) === 1200, JSON.stringify(k1.error ?? k1.data));
  const k2 = await kd({ amount: 83.34, kdv_rate: 20, kdv_amount: 16.67, description: "KDV dahil 100,01" });
  check("KDV dahil 100,01 @%20 → matrah 83,34 + KDV 16,67 = 100,01 (kuruşu kuruşuna)", !k2.error && Number(k2.data?.total_with_kdv) === 100.01, JSON.stringify(k2.error ?? k2.data));
  const k3 = await kd({ amount: 500, kdv_rate: 18, kdv_amount: 90, description: "Eski oran %18" });
  const k4 = await kd({ amount: 250, kdv_rate: 8, kdv_amount: 20, description: "Oran %8" });
  const k5 = await kd({ amount: 1000, kdv_rate: 7.5, kdv_amount: 75, description: "Ondalıklı oran" });
  check("özel oranlar kabul edilir (%18, %8, %7,5)", !k3.error && !k4.error && !k5.error, JSON.stringify([k3.error, k4.error, k5.error]));
  check("tutarsız KDV reddedilir (100 @%20 için KDV 5)", !!(await kd({ amount: 100, kdv_rate: 20, kdv_amount: 5 })).error);
  check("oran 0 iken KDV yazılamaz", !!(await kd({ amount: 100, kdv_rate: 0, kdv_amount: 20 })).error);
  check("100'den büyük oran reddedilir", !!(await kd({ amount: 100, kdv_rate: 101, kdv_amount: 101 })).error);
  check("negatif oran reddedilir", !!(await kd({ amount: 100, kdv_rate: -5, kdv_amount: 0 })).error);
  check("negatif KDV tutarı reddedilir", !!(await kd({ amount: 100, kdv_rate: 0, kdv_amount: -1 })).error);
  check("KDV dahil toplam elle yazılamaz (otomatik sütun)", !!(await kd({ amount: 100, total_with_kdv: 5 })).error);
  check("sahip KDV'yi tutarlı biçimde güncelleyebilir (oran %10, KDV 100)", (await c.owner.from("invoices").update({ kdv_rate: 10, kdv_amount: 100 }).eq("id", k1.data!.id).select("id")).data?.length === 1 && Number((await c.owner.from("invoices").select("total_with_kdv").eq("id", k1.data!.id).single()).data?.total_with_kdv) === 1100);
  check("tutarsız KDV güncellemesi reddedilir", !!(await c.owner.from("invoices").update({ kdv_amount: 1 }).eq("id", k1.data!.id)).error);
  check("ortak, sahibin faturasının KDV'sini güncelleyemez", denied(await c.partner.from("invoices").update({ kdv_rate: 0, kdv_amount: 0 }).eq("id", k1.data!.id).select("id")));
  await c.owner.from("invoices").update({ kdv_rate: 20, kdv_amount: 200 }).eq("id", k1.data!.id);

  // özet: sahibin faturaları — KDV hariç toplam 8500,50 + 1000 + 83,34 + 500 + 250 + 1000 = 11333,84; KDV 200 + 16,67 + 90 + 20 + 75 = 401,67
  const sumK = ((await c.owner.rpc("get_billing_summary", { p_site_id: siteA, p_owner: ids.owner })).data ?? []) as { kind: string; total: string; kdv: string }[];
  const fk = sumK.filter((r) => r.kind === "fatura");
  check("özet: fatura toplamı KDV HARİÇ (11333,84)", Math.round(fk.reduce((t, r) => t + Number(r.total), 0) * 100) === 1133384, JSON.stringify(fk));
  check("özet: faturalardaki KDV toplamı 401,67", Math.round(fk.reduce((t, r) => t + Number(r.kdv), 0) * 100) === 40167, JSON.stringify(fk));
  check("özet: hakediş satırının KDV'si 0", Number(sumK.find((r) => r.kind === "hakedis")?.kdv) === 0);
  const range = { p_site_id: siteA, p_from: "2026-09-01", p_to: "2026-09-30" };
  const monthsA = ((await c.admin.rpc("get_billing_report", range)).data ?? []) as { owner_id: string; invoices: string; invoice_kdv: string }[];
  check("rapor (admin): ay bazında fatura KDV'si 401,67", Math.round(monthsA.filter((r) => r.owner_id === ids.owner).reduce((t, r) => t + Number(r.invoice_kdv), 0) * 100) === 40167, JSON.stringify(monthsA));
  const totA = ((await c.admin.rpc("get_billing_totals", { p_site_id: siteA })).data ?? []) as { owner_id: string; invoice_kdv: string }[];
  check("rapor (admin): tüm zamanlar KDV 401,67", Math.round(Number(totA.find((r) => r.owner_id === ids.owner)?.invoice_kdv) * 100) === 40167, JSON.stringify(totA));
  check("genel özet: dönem fatura KDV'si 401,67", Math.round(Number(((await c.owner.rpc("get_site_overview", range)).data as { invoice_kdv: string }).invoice_kdv) * 100) === 40167);
  check("rapor: şantiye dışı KDV göremez", Number(((await c.outsider.rpc("get_site_overview", range)).data as { invoice_kdv: string }).invoice_kdv) === 0);
  check("rapor: ortak sahibin KDV'sini göremez", ((((await c.partner.rpc("get_billing_totals", { p_site_id: siteA })).data ?? []) as { owner_id: string }[]).every((r) => r.owner_id !== ids.owner)));
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  let delErr: string | undefined;
  if (siteIds.length) delErr = (await svc.from("sites").delete().in("id", siteIds)).error?.message;
  for (const id of Object.values(ids)) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", Object.values(ids));
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  const leftP = siteIds.length ? await svc.from("progress_payments").select("id").in("site_id", siteIds) : { data: [] };
  const leftI = siteIds.length ? await svc.from("invoices").select("id").in("site_id", siteIds) : { data: [] };
  check("test verisi temizlendi", !delErr && !left.data?.length && !leftSites.data?.length && !leftP.data?.length && !leftI.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
