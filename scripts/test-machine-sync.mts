/** Bütünlük testi: makine puantajı değişince kira ödemesinin otomatik güncellenmesi (tetikleyici private.sync_machine_rental).
 *  Geçici hesap/şantiye açar, gerçek oturumla dener, sonunda hepsini siler.
 *  Çalıştırma: npm run test:machine-sync  (.env.local içinde SUPABASE_SERVICE_ROLE_KEY gerekir) */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const tag = randomBytes(4).toString("hex");
const pw = () => randomBytes(12).toString("base64url") + "aA1";
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);

// Geçen ayın günleri (gelecek tarih kuralına takılmamak için)
const now = new Date();
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const prevYm = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
const day = (n: number) => `${prevYm}-${String(n).padStart(2, "0")}`;
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

let siteId = 0;
const userIds: string[] = [];
try {
  const mkUser = async (name: string) => {
    const email = `t-${name}-${tag}@example.test`;
    const password = pw();
    const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    await svc.from("users").insert({ id: data.user.id, full_name: `T ${name} ${tag}`, email, role: "partner", must_change_password: false });
    userIds.push(data.user.id);
    const c = createClient(url, anon, { auth: { persistSession: false } });
    const { error: e2 } = await c.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    return { id: data.user.id, c };
  };
  const owner = await mkUser("owner");
  const other = await mkUser("other");
  const { data: site } = await svc.from("sites").insert({ name: `Senkron ${tag}`, created_by: owner.id }).select("id").single();
  siteId = site!.id;
  await svc.from("site_members").insert([{ site_id: siteId, user_id: owner.id, role: "owner" }, { site_id: siteId, user_id: other.id, role: "partner" }]);
  const { data: cat } = await svc.from("categories").select("id").is("site_id", null).eq("name", "Kira (araç / ekipman)").single();

  const c: SupabaseClient = owner.c;
  const mk = async (name: string, unit: "day" | "hour" | null, rate: number | null, who = owner) =>
    (await who.c.from("machines").insert({ site_id: siteId, owner_id: who.id, name: `${name} ${tag}`, machine_type: "kepce", ownership: unit ? "rented" : "own", rate_unit: unit, rental_rate: rate }).select("id").single()).data!.id as number;
  const mark = (mid: number, d: string, who = owner) => who.c.rpc("set_machine_attendance", { p_site_id: siteId, p_work_date: d, p_add: [mid], p_remove: [] });
  const unmark = (mid: number, d: string, who = owner) => who.c.rpc("set_machine_attendance", { p_site_id: siteId, p_work_date: d, p_add: [], p_remove: [mid] });
  const pay = async (mid: number, qty: number, rate: number, unit: "day" | "hour", date = today, month = prevYm) =>
    (await c.from("transactions").insert({
      site_id: siteId, user_id: owner.id, type: "expense", description: `Ay kirası — Makine (${String(qty).replace(".", ",")} ${unit === "day" ? "gün" : "saat"} × ₺${rate},00)`, amount: Math.round(qty * rate * 100) / 100,
      transaction_date: date, category_id: cat!.id, machine_id: mid, machine_qty: qty, machine_rate: rate, machine_unit: unit, period_month: `${month}-01`,
    }).select("id").single()).data!.id as number;
  const txs = async (mid: number) => ((await svc.from("transactions").select("id, amount, machine_qty, description, transaction_date").eq("machine_id", mid).order("transaction_date", { ascending: false }).order("id", { ascending: false })).data ?? []).map((r) => ({ ...r, amount: Number(r.amount), qty: Number(r.machine_qty) }));

  // ---------- A. günlük kira, tam ödenmiş ay ----------
  const A = await mk("Gunluk Kepce", "day", 5000);
  for (const d of [1, 2, 3]) await mark(A, day(d));
  await pay(A, 3, 5000, "day");
  check("A: ödeme yazıldı (3 gün, 15000)", (await txs(A))[0]?.amount === 15000);
  await unmark(A, day(3));
  let t = (await txs(A))[0];
  check("A: gün kaldırılınca ödeme 2 güne ve ₺10.000'e düştü", t?.qty === 2 && t.amount === 10000, JSON.stringify(t));
  check("A: açıklamadaki miktar da güncellendi ('(2 gün ×')", t?.description.includes("(2 gün ×") === true, t?.description);
  await mark(A, day(3));
  t = (await txs(A))[0];
  check("A: gün geri işaretlenince ödeme 3 gün / ₺15.000'e geri geldi", t?.qty === 3 && t.amount === 15000 && t.description.includes("(3 gün ×"), JSON.stringify(t));
  await mark(A, day(4));
  t = (await txs(A))[0];
  check("A: ödemeden sonra YENİ gün işaretlenince ödeme de artar (4 gün, ₺20.000) — tam ödenmiş ay izler", t?.qty === 4 && t.amount === 20000, JSON.stringify(t));
  await unmark(A, day(4));
  check("A: yeni gün kaldırılınca tekrar 3 gün", (await txs(A))[0]?.qty === 3);
  check("A: tek ödeme kaydı kaldı (çoğalma yok)", (await txs(A)).length === 1);

  // ---------- B. kısmi ödeme: dokunulmaz ----------
  const B = await mk("Kismi Kepce", "day", 5000);
  for (const d of [1, 2, 3]) await mark(B, day(d));
  await pay(B, 2, 5000, "day");
  await unmark(B, day(3));
  check("B: kısmi ödemede gün kaldırılınca ödeme DEĞİŞMEZ (2 gün, ₺10.000)", ((await txs(B))[0]?.qty ?? 0) === 2 && (await txs(B))[0].amount === 10000);
  await mark(B, day(3));
  check("B: kısmi ödemede gün geri eklenince de değişmez (ödenmemiş gün 'ödenmiş' yazılmaz)", (await txs(B))[0].qty === 2);

  const flag = async (mid: number) => ((await svc.from("transactions").select("machine_synced").eq("machine_id", mid)).data ?? []).map((r) => r.machine_synced);
  check("B: kısmi ödeme 'bağlı' değildir (machine_synced = false)", (await flag(B)).every((f) => f === false));
  check("A: tam ödenmiş ay 'bağlıdır' (machine_synced = true)", (await flag(A)).every((f) => f === true));
  // Kısmi ödeme sonradan tamamlanınca (toplam = puantaj) ay bağlı olur ve senkron başlar
  await pay(B, 1, 5000, "day", today); // aynı gün: en yeni kayıt (id) bu ödeme
  check("B: kalan ödeme yapılınca (2 + 1 = 3 gün) iki ödeme de 'bağlı' olur", (await flag(B)).length === 2 && (await flag(B)).every((f) => f === true));
  await unmark(B, day(3));
  const bAfter = await txs(B);
  check("B: bağlanınca gün kaldırılırsa en yeni ödeme (1 gün) silinir, eski ödeme (2 gün) kalır", bAfter.length === 1 && bAfter[0].qty === 2, JSON.stringify(bAfter));
  await mark(B, day(3));
  check("B: gün geri gelince ödeme 3 güne çıkar", (await txs(B))[0]?.qty === 3);

  // ---------- C. birden çok ödeme: en yeniden azalır, tamamı çıkarsa silinir ----------
  const C = await mk("Cok Odemeli Kepce", "day", 5000);
  for (const d of [1, 2, 3]) await mark(C, day(d));
  const c1 = await pay(C, 2, 5000, "day", day(20));
  const c2 = await pay(C, 1, 5000, "day", day(25));
  void c1;
  await unmark(C, day(3));
  let rows = await txs(C);
  check("C: en yeni ödeme (1 gün) tamamen çıktığı için silindi; eski ödeme (2 gün) kaldı", rows.length === 1 && rows[0].qty === 2 && rows[0].id !== c2, JSON.stringify(rows));
  await unmark(C, day(2));
  rows = await txs(C);
  check("C: bir gün daha kaldırılınca eski ödeme 1 güne düştü (₺5.000)", rows.length === 1 && rows[0].qty === 1 && rows[0].amount === 5000, JSON.stringify(rows));
  await mark(C, day(2));
  check("C: gün geri gelince kalan ödeme 2 güne çıktı", (await txs(C))[0]?.qty === 2);
  await unmark(C, day(1));
  await unmark(C, day(2));
  check("C: tüm günler kaldırılınca ödeme kalmaz", (await txs(C)).length === 0);

  // ---------- D. saatlik kira ----------
  const D = await mk("Saatlik Greyder", "hour", 900);
  await mark(D, day(1));
  await mark(D, day(2));
  await c.from("machine_attendance").update({ hours: 8 }).eq("machine_id", D).eq("work_date", day(1));
  await c.from("machine_attendance").update({ hours: 6 }).eq("machine_id", D).eq("work_date", day(2));
  await pay(D, 14, 900, "hour");
  check("D: saatlik ödeme yazıldı (14 saat, ₺12.600)", (await txs(D))[0]?.amount === 12600);
  await c.from("machine_attendance").update({ hours: 4 }).eq("machine_id", D).eq("work_date", day(2));
  t = (await txs(D))[0];
  check("D: saat azalınca (6→4) ödeme 12 saat / ₺10.800", t?.qty === 12 && t.amount === 10800 && t.description.includes("(12 saat ×"), JSON.stringify(t));
  await unmark(D, day(1));
  t = (await txs(D))[0];
  check("D: 8 saatlik gün kaldırılınca ödeme 4 saat / ₺3.600", t?.qty === 4 && t.amount === 3600, JSON.stringify(t));
  await mark(D, day(1));
  check("D: günü saatsiz yeniden işaretlemek ödemeyi değiştirmez (saat girilene kadar)", (await txs(D))[0]?.qty === 4);
  await c.from("machine_attendance").update({ hours: 8 }).eq("machine_id", D).eq("work_date", day(1));
  t = (await txs(D))[0];
  check("D: saat tekrar girilince ödeme 12 saat / ₺10.800'e döndü (Geri al akışı)", t?.qty === 12 && t.amount === 10800, JSON.stringify(t));
  await c.from("machine_attendance").update({ note: "yalnızca not" }).eq("machine_id", D).eq("work_date", day(1));
  check("D: yalnızca not değişince ödeme değişmez", (await txs(D))[0]?.qty === 12);

  // ---------- D2. ödeme elle değiştirilirse bağ çözülür ----------
  const D2 = await mk("Elle Duzenlenen Kepce", "day", 5000);
  for (const d of [1, 2, 3]) await mark(D2, day(d));
  const d2tx = await pay(D2, 3, 5000, "day");
  check("D2: tam ödeme bağlı", (await flag(D2)).every((f) => f === true));
  await c.from("transactions").update({ machine_qty: 2, amount: 10000 }).eq("id", d2tx);
  check("D2: ödeme 2 güne elle düşürülünce bağ çözülür (machine_synced = false)", (await flag(D2)).every((f) => f === false));
  await unmark(D2, day(3));
  check("D2: bağ çözülünce puantaj değişse de ödeme değişmez", (await txs(D2))[0].qty === 2);
  await c.from("transactions").delete().eq("id", d2tx);
  check("D2: ödeme silinince hata yok ve kayıt kalmaz", (await txs(D2)).length === 0);

  // ---------- E. dökümü temizlenmiş ödeme: dokunulmaz ----------
  const E = await mk("Bozuk Kepce", "day", 5000);
  for (const d of [1, 2]) await mark(E, day(d));
  const e1 = await pay(E, 2, 5000, "day");
  await c.from("transactions").update({ amount: 9000, machine_qty: null, machine_rate: null, machine_unit: null }).eq("id", e1);
  await unmark(E, day(2));
  const er = (await svc.from("transactions").select("amount, machine_qty").eq("id", e1).single()).data!;
  check("E: döküm temizlenmiş ödemeye dokunulmaz (₺9.000, miktar boş)", Number(er.amount) === 9000 && er.machine_qty === null);

  // ---------- F. başka ay ve başka ortak etkilenmez ----------
  const F = await mk("Ay Kepce", "day", 5000);
  await mark(F, day(1));
  await mark(F, day(2));
  const curYm = today.slice(0, 7);
  await pay(F, 2, 5000, "day", today, curYm); // bu ayın ödemesi, puantaj geçen ayda
  await unmark(F, day(2));
  check("F: başka ayın ödemesi, geçen ayın puantajından etkilenmez", (await txs(F))[0]?.qty === 2);
  const G = await mk("Ortak Kepcesi", "day", 5000, other);
  await mark(G, day(1), other);
  await other.c.from("transactions").insert({ site_id: siteId, user_id: other.id, type: "expense", description: "x (1 gün × ₺5.000,00)", amount: 5000, transaction_date: today, category_id: cat!.id, machine_id: G, machine_qty: 1, machine_rate: 5000, machine_unit: "day", period_month: `${prevYm}-01` });
  await unmark(A, day(1));
  check("G: bir ortağın puantajı başka ortağın makinesinin ödemesini etkilemez", (await txs(G))[0]?.qty === 1);
  await mark(A, day(1));
  await unmark(G, day(1), other);
  check("G: ortağın kendi makinesinde senkron çalışır (ödeme silindi)", (await txs(G)).length === 0);

  // ---------- H. kendi (kiralık olmayan) makine ----------
  const H = await mk("Kendi Kepce", null, null);
  check("H: kendi makinede puantaj işaretleme/kaldırma sorunsuz çalışır", !(await mark(H, day(1))).error && !(await unmark(H, day(1))).error);
} catch (e) {
  check("test akışı hatasız çalıştı", false, String((e as Error).message ?? e));
} finally {
  let delErr: string | undefined;
  if (siteId) {
    // Ödemeli makineler silinemediği için önce şantiye silinir (CASCADE; tetikleyici iç içe silmede ödemeye dokunmaz)
    delErr = (await svc.from("sites").delete().eq("id", siteId)).error?.message;
  }
  for (const id of userIds) await svc.auth.admin.deleteUser(id);
  const left = await svc.from("users").select("id").in("id", userIds);
  const leftSites = await svc.from("sites").select("id").like("name", `% ${tag}`);
  check("test verisi temizlendi (ödemeli makineli şantiye CASCADE ile silinir)", !delErr && !left.data?.length && !leftSites.data?.length, delErr);
}

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  -> " + d : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} geçti`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
