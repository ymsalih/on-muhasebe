# Şantiye Ön Muhasebe Projesi — CLAUDE.md

Bu dosya, Claude Code'un bu projede her oturumda otomatik okuduğu proje hafızasıdır. Yeni bir oturum başladığında önce bu dosyayı oku, sonra göreve başla. Mimariyi ve aşağıdaki kuralları değiştirmeden önce kullanıcıya sor.

## 1. Proje Özeti

Birden fazla ortağın (ör. Veysel, ve diğer ortaklar) kendi kullanıcı adı/e-posta ve şifresiyle giriş yaptığı, her ortağın birden çok şantiyeyi yönetebildiği, tam kapsamlı ve modüler bir **şantiye ön muhasebe sistemi**.

Temel prensip — **modülerlik**: bir ortak yeni bir şantiye eklediğinde, o şantiyeye ait tüm veriler (irsaliye, personel, puantaj, cari hesap, kasa hareketleri) diğer şantiyelerden tamamen izole tutulur. Aynı ekran/akış her şantiye için tekrar kullanılır, veri karışmaz.

İkinci prensip — **rol ayrımı** (ÖNEMLİ — sık karışan nokta, dikkatle uygula):
- **Admin paneli SADECE şunun için var**: (1) yeni ortak **kullanıcı hesabı** oluşturmak (e-posta/şifre ile giriş bilgisi açmak), (2) tüm ortakları ve tüm şantiyeleri **salt görüntüleme** amaçlı genel olarak listelemek. Admin panelinde **şantiye oluşturma yoktur** ve admin hiçbir şantiyeye kendiliğinden üye olmaz.
- **Ortak paneli**: giriş yapan ortak, önce erişebildiği şantiyelerden birini seçer, sonra o şantiyenin panelinde çalışır. **Yeni şantiye eklemek her ortağın kendi panelinden yapabildiği bir işlemdir** — admin yetkisi gerektirmez. Bir ortak yeni şantiye oluşturduğunda otomatik olarak o şantiyenin `owner`'ı olur (`site_members`'a `role='owner'` ile kendisi eklenir). Sahibi olduğu bir şantiyeye, sistemde zaten hesabı olan başka bir ortağı (admin'in daha önce oluşturduğu bir kullanıcıyı) davet edip **site_members**'a ekleyebilir — böylece iki ortak aynı şantiye üzerinde birlikte çalışabilir, her biri kendi görünümünü (Genel / Kendi Panelim) kullanır.
- Örnek senaryo: Admin, Veysel ve ikinci ortağın kullanıcı hesaplarını açar (sadece giriş bilgisi verir). Veysel giriş yapar → kendi panelinden "Yeni Şantiye Ekle" der → o şantiyenin owner'ı olur → ikinci ortağı bu şantiyeye üye olarak ekler → ikisi de aynı şantiyede, ayrı panellerle çalışır. Veysel başka bir şantiye daha eklerse, bu tamamen ayrı ve izole bir veri seti olur.

## 2. Teknoloji Yığını

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (Postgres + Auth + Row Level Security) — ayrı bir backend yazılmaz, yetkilendirme veritabanı seviyesinde RLS ile yapılır
- TanStack Query — veri çekme/önbellekleme
- react-hook-form + zod — form doğrulama
- Recharts — raporlama/analiz grafikleri

## 3. Roller ve Yetkilendirme Mantığı

- `users.role`: `admin` veya `partner`.
- `site_members` tablosu, hangi kullanıcının hangi şantiyeye erişebildiğini tutar (çok-çok ilişki).
- **Admin**: `site_members`'tan bağımsız, tüm `sites` ve tüm ilişkili verileri **salt görüntüleme** amaçlı görebilir; yeni **kullanıcı hesabı** oluşturabilir (`supabase.auth.admin.createUser`). **Admin şantiye oluşturamaz, site_members'a satır ekleyemez/kendini bir şantiyeye üye yapamaz** — bu, ortakların kendi işidir.
- **Partner**: yalnızca `site_members` üzerinden üyesi olduğu `site_id`'lere ait verileri görebilir. Kendi panelinden yeni şantiye oluşturabilir (bu işlem sırasında kendisi otomatik `owner` olarak `site_members`'a eklenir) ve sahibi olduğu şantiyeye, sistemde zaten var olan başka bir ortağı üye olarak ekleyebilir.
- **RLS insert politikaları bu ayrıma göre kurulur**:
  - `sites` INSERT → herhangi bir giriş yapmış kullanıcı (`auth.uid() IS NOT NULL`) ekleyebilir; `created_by = auth.uid()`.
  - `site_members` INSERT → iki durumda izinli: (a) kullanıcı kendini, **kendi az önce oluşturduğu** şantiyeye `role='owner'` olarak ekliyorsa (`site_id`'nin `sites.created_by = auth.uid()` olması şartı aranır), (b) o şantiyede zaten `owner` olan kullanıcı, başka bir mevcut kullanıcıyı aynı şantiyeye ekliyorsa. Admin bu tabloya satır eklemez.
  - `sites`/`site_members` üzerinde admin sadece SELECT (görüntüleme) yetkisine sahiptir.
- Erişim kontrolü Supabase RLS politikalarıyla veritabanı seviyesinde uygulanır; uygulama kodunda ayrıca yetki kontrolü tekrar yazılmaz.
- Her operasyonel tablo (`goods_entries`, `personnel`, `attendance`, `parties`, `transactions` vb.) bir `site_id` sütunu taşır — modülerliğin temeli budur.

## 4. Veritabanı Şeması

```sql
-- ============================================================
-- KULLANICILAR VE ŞANTİYELER
-- ============================================================

-- FAZ 1'DE UYGULANDI (supabase/migrations/): users.id artık auth.users.id ile eşleşen UUID'dir.
-- Not: aşağıdaki diğer tablolarda `users(id)` referansları da UUID olmalı (created_by, user_id, recorded_by...) —
-- ilgili fazın migration'ında INTEGER yerine UUID yazılır. RLS için private.has_site_access(site_id) kullanılır.
CREATE TABLE users (
  id                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name             VARCHAR(120) NOT NULL,
  email                 VARCHAR(180) UNIQUE NOT NULL,
  role                  VARCHAR(20) NOT NULL DEFAULT 'partner' CHECK (role IN ('admin','partner')),
  phone                 VARCHAR(30),
  must_change_password  BOOLEAN NOT NULL DEFAULT true,   -- true: giriş sonrası şifre değiştirmeye zorlanır
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);  -- password_hash YOK: şifre yalnızca Supabase Auth'ta

CREATE TABLE sites (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  address     TEXT,
  start_date  DATE,
  status      VARCHAR(20) NOT NULL DEFAULT 'active',   -- active / closed
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Modülerliğin çekirdeği: kim hangi şantiyeye erişebiliyor
CREATE TABLE site_members (
  id                SERIAL PRIMARY KEY,
  site_id           INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role              VARCHAR(20) NOT NULL DEFAULT 'partner',  -- owner / partner / viewer
  share_percentage  NUMERIC(5,2),             -- kâr payı yüzdesi (opsiyonel)
  joined_at         TIMESTAMP DEFAULT now(),
  UNIQUE (site_id, user_id)
);

-- ============================================================
-- İRSALİYE / FATURA / FİŞ GİRİŞİ
-- ============================================================

CREATE TABLE parties (
  -- önce tanımlanır çünkü goods_entries ve transactions buna referans verir
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name          VARCHAR(150) NOT NULL,   -- kişi / firma adı, ya da araç kiralamada plaka
  category      VARCHAR(30) NOT NULL DEFAULT 'firma',  -- firma / nakliyeci / arac / musteri / diger
  address       TEXT,
  phone         VARCHAR(30),
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE goods_entries (
  id                SERIAL PRIMARY KEY,
  site_id           INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  entry_date        DATE NOT NULL,                                    -- 1. tarih
  document_type     VARCHAR(20) NOT NULL CHECK (document_type IN ('fis','fatura','irsaliye')), -- 2. FİŞ/FATURA/İRSALİYE
  document_no       VARCHAR(50),                                      -- 3. irsaliye no
  party_id          INTEGER REFERENCES parties(id),                    -- 4. firma
  material_type     VARCHAR(150),                                     -- 5. malzeme türü
  unit              VARCHAR(30),                                      -- 6. birim
  variant           VARCHAR(150),                                     -- 7. çeşidi / cinsi / çapı
  quantity          NUMERIC(14,2),                                    -- 8. miktarı
  used_location     VARCHAR(150),                                     -- 9. kullanıldığı yer
  purchase_location VARCHAR(150),                                     -- 10. satın alma yeri
  transport_cost    NUMERIC(14,2) DEFAULT 0,                          -- 11. nakliye tutarı
  info              TEXT,                                             -- 12. bilgi
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMP DEFAULT now()
);

-- ============================================================
-- PERSONEL
-- ============================================================

CREATE TABLE personnel (
  id                     SERIAL PRIMARY KEY,
  site_id                INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  full_name              VARCHAR(150) NOT NULL,      -- 1. adı soyadı
  tc_no                  VARCHAR(11),                 -- 2. tc kimlik no  (HASSAS VERİ — bkz. Bölüm 6)
  employer_party_id      INTEGER REFERENCES parties(id),  -- 3. çalıştığı firma
  insurance_company      VARCHAR(150),                -- 4. sigortayı yapan firma
  job                    VARCHAR(100),                -- 5. işi
  duty                   VARCHAR(100),                -- 6. görevi
  status                 VARCHAR(30) DEFAULT 'aktif', -- 7. durumu (aktif/izinli/raporlu/gecici_gorevde/ayrildi)
  hire_date              DATE,                        -- 8. işe giriş tarihi
  termination_date       DATE,                        -- 9. işten çıkış tarihi
  temp_assignment_start  DATE,                         -- 10. geçici görev başlangıç tarihi
  report_start           DATE,                         -- 11. rapor başlangıç tarihi
  leave_start            DATE,                         -- 12. izin başlangıç tarihi
  absence_days_count     INTEGER,                      -- 13. geçici görev/rapor/izin gün sayısı
  return_date            DATE,                         -- 14. işe dönüş tarihi
  iban                   VARCHAR(34),                  -- 15. iban no
  phone                  VARCHAR(30),                  -- 16. telefon
  created_at             TIMESTAMP DEFAULT now()
);

-- İBAN BİLGİLERİ — personel dışında ödeme yapılan herkes için de kullanılabilen ayrı liste
CREATE TABLE payment_accounts (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  full_name     VARCHAR(150) NOT NULL,   -- 1. ad soyad
  iban          VARCHAR(34) NOT NULL,    -- 2. iban
  profession    VARCHAR(100),            -- 3. meslekleri
  personnel_id  INTEGER REFERENCES personnel(id),  -- opsiyonel: personelle ilişkilendir
  party_id      INTEGER REFERENCES parties(id),    -- opsiyonel: cari ile ilişkilendir
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT now()
);

-- PUANTAJ — "günlük gelenler" ekranının veritabanı karşılığı
CREATE TABLE attendance (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  personnel_id  INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  work_date     DATE NOT NULL,
  recorded_by   INTEGER REFERENCES users(id),
  note          TEXT,
  created_at    TIMESTAMP DEFAULT now(),
  UNIQUE (personnel_id, work_date)   -- aynı kişi aynı gün iki kez işaretlenemez
);

-- ============================================================
-- GENEL KASA (gelir/gider — finans merkezi)
-- ============================================================

CREATE TABLE categories (
  id         SERIAL PRIMARY KEY,
  site_id    INTEGER REFERENCES sites(id) ON DELETE CASCADE,  -- NULL = tüm şantiyelerde görünen varsayılan kategori
  name       VARCHAR(80) NOT NULL,
  type       VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE transactions (
  id                SERIAL PRIMARY KEY,
  site_id           INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id),          -- işlemi giren ortak
  category_id       INTEGER REFERENCES categories(id),
  party_id          INTEGER REFERENCES parties(id),                  -- ödemenin yapıldığı/geldiği cari
  personnel_id      INTEGER REFERENCES personnel(id),                 -- puantaja bağlı maaş ödemesiyse
  goods_entry_id    INTEGER REFERENCES goods_entries(id),             -- bir irsaliye/faturaya bağlıysa
  type              VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
  description       TEXT NOT NULL,                                   -- kime, ne için ödendiği açıklaması
  amount            NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency          VARCHAR(3) DEFAULT 'TRY',
  payment_method    VARCHAR(20),          -- nakit / havale / cek / diger
  transaction_date  DATE NOT NULL,
  created_at        TIMESTAMP DEFAULT now(),
  updated_at        TIMESTAMP DEFAULT now()
);

CREATE TABLE transaction_attachments (   -- fiş/fatura fotoğrafı (opsiyonel)
  id             SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  file_url       TEXT NOT NULL,
  uploaded_at    TIMESTAMP DEFAULT now()
);

-- ============================================================
-- İNDEKSLER
-- ============================================================

CREATE INDEX idx_transactions_site      ON transactions(site_id);
CREATE INDEX idx_transactions_user      ON transactions(user_id);
CREATE INDEX idx_transactions_site_user ON transactions(site_id, user_id);
CREATE INDEX idx_transactions_party     ON transactions(party_id);
CREATE INDEX idx_transactions_date      ON transactions(transaction_date);  -- gün/ay filtreleme için
CREATE INDEX idx_attendance_site_date   ON attendance(site_id, work_date);
CREATE INDEX idx_goods_entries_site     ON goods_entries(site_id);
CREATE INDEX idx_personnel_site         ON personnel(site_id);
CREATE INDEX idx_parties_site           ON parties(site_id);
CREATE INDEX idx_site_members_user      ON site_members(user_id);

-- ============================================================
-- VIEW'LER (hesaplanan alanlar tabloya asla yazılmaz)
-- ============================================================

-- Cari hesap: toplam ciro / bakiye — parties tablosuna sabit sütun olarak EKLENMEZ,
-- her zaman transactions'tan canlı hesaplanır.
CREATE VIEW party_balances AS
SELECT
  p.id AS party_id,
  p.site_id,
  p.name,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)  AS total_income,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS total_expense,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)
    - COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS balance,
  COALESCE(SUM(t.amount), 0) AS total_turnover
FROM parties p
LEFT JOIN transactions t ON t.party_id = p.id
GROUP BY p.id, p.site_id, p.name;

-- Aylık puantaj özeti: "kaç gün geldi" → bordro/ödeme hesaplamasının temeli
CREATE VIEW monthly_attendance_summary AS
SELECT
  personnel_id,
  site_id,
  date_trunc('month', work_date) AS month,
  COUNT(*) AS days_worked
FROM attendance
GROUP BY personnel_id, site_id, date_trunc('month', work_date);

-- Şantiye geneli kasa özeti: gün/ay filtreli raporlama bu view üzerinden yapılır
CREATE VIEW site_cash_summary AS
SELECT
  site_id,
  date_trunc('month', transaction_date) AS month,
  type,
  category_id,
  SUM(amount) AS total
FROM transactions
GROUP BY site_id, date_trunc('month', transaction_date), type, category_id;
```

## 5. Modülerlik ve Panel Mantığı

| Senaryo | Sorgu mantığı |
|---|---|
| Admin paneli | `site_id` filtresi yok — tüm şantiyeler ve tüm kullanıcılar görünür, yeni ortak/şantiye ekleme yetkisi var |
| Ortak — şantiye seçimi | Giriş sonrası `site_members WHERE user_id = X` sorgulanır, kullanıcıya erişebildiği şantiyelerin listesi/seçici olarak sunulur |
| Ortak — seçili şantiye paneli | Seçilen `site_id` context olarak tutulur (URL'de `/sites/[siteId]/...` veya session state); o andan sonraki her sorgu bu `site_id` ile filtrelenir |
| Yeni şantiye ekleme | `sites` tablosuna satır + `site_members` tablosuna ekleyen kullanıcı için satır eklenir. Diğer tüm tablolar zaten `site_id` taşıdığı için otomatik izole olur, şema değişmez |

Örnek: Veysel giriş yapar → `site_members` sorgusu Veysel'in 2 şantiyesi olduğunu gösterir → Veysel birini seçer → irsaliye eklediğinde kayıt `site_id = 1` ile yazılır → diğer şantiyeye (`site_id = 2`) geçtiğinde farklı, tamamen ayrı bir irsaliye/personel/cari/kasa verisi görür.

## 6. Kurallar ve Güvenlik Notları

- Migration dosyaları `supabase/migrations/` altında tutulur; şema değişikliği asla doğrudan Supabase dashboard'undan elle yapılmaz.
- **`personnel.tc_no` hassas kişisel veridir**: sadece admin ve ilgili şantiyenin ortakları görebilmeli. Ayrı bir RLS politikası veya `SECURITY DEFINER` fonksiyon ile erişimi kısıtla; varsayılan API cevaplarında maskelenmeden dönmemeli.
- **`parties` için toplam ciro / bakiye alanları tabloya kaydedilmez** — her zaman `party_balances` view'inden hesaplanır. Bu, elle güncelleme unutulduğunda oluşacak veri tutarsızlığını (kayıtlı bakiye ile gerçek toplam işlemlerin uyuşmaması) baştan engeller.
- Bir cari (`party`) aynı zamanda kiralık bir araç da olabilir (`category = 'arac'`, `name` alanına plaka yazılır) — bunun için ayrı bir "araçlar" tablosu açılmaz, `parties` yapısı zaten modüler şekilde bunu karşılar. Cariye tıklanınca `party_balances` + o cariye bağlı `transactions` listesi (tarih, açıklama, tutar, not) detay olarak gösterilir.
- `attendance` tablosundaki `UNIQUE(personnel_id, work_date)` kısıtı, "Günlük Gelenler" ekranında aynı kişinin aynı günde iki kez işaretlenmesini veritabanı seviyesinde engeller.
- Genel kasa ekranında **gün ve ay bazlı filtreleme zorunlu bir gereksinimdir** — `transactions.transaction_date` üzerinden filtrelenir, `idx_transactions_date` bu sorguları hızlandırmak için eklendi.
- Her yeni tablo/kolon eklerken önce migration dosyasını yaz, sonra UI/kod tarafını yaz; CLAUDE.md'yi de o değişikliğe göre güncelle.
- **Kullanıcı ekleme akışı (Auth)**: herkese açık bir "kayıt ol" ekranı YOK. Yalnızca admin, "Yeni Ortak Ekle" formuyla `supabase.auth.admin.createUser({ email, password, email_confirm: true })` çağırır — `email_confirm: true` e-posta doğrulama adımını atlar, çünkü bu kapalı/davetli bir sistemdir, herkese açık kayıt riski yoktur. Admin, oluşturduğu geçici şifreyi ortağa güvenli bir kanaldan (e-posta değil — WhatsApp/telefon) iletir. Ortak ilk girişte bu şifreyle içeri girer ve **ilk girişte şifre değiştirmeye zorlanır** (`must_change_password` bayrağı `users` tablosunda tutulur, `true` ise giriş sonrası doğrudan şifre değiştirme ekranına yönlendirilir).
- **İlk admin kullanıcısının oluşturulması (bootstrap)**: sistemde admin yokken kimse "Yeni Ortak Ekle" formunu kullanamaz — bu yumurta-tavuk sorununu çözmek için Faz 1 kapsamında tek seferlik, tekrar çalıştırılabilir bir **seed script** yazılır (ör. `scripts/create-first-admin.ts`). Script: (1) verilen e-posta/şifre ile `supabase.auth.admin.createUser({ email, password, email_confirm: true })` çağırır, (2) dönen `auth.users.id`'yi kullanarak `users` tablosuna `role = 'admin'` olarak satır ekler. `users.id` alanı bu yüzden `SERIAL` değil, `auth.users.id` ile birebir eşleşen `UUID REFERENCES auth.users(id)` olmalıdır — Bölüm 4'teki şema Faz 1'de buna göre güncellenir. Script, komut satırından `npx tsx scripts/create-first-admin.ts` gibi çalıştırılır ve her yeni ortamda (yerel/test/production) ilk admini oluşturmak için tekrar kullanılabilir; production'da çalıştırıldıktan sonra sızıntı riskine karşı script'teki şifre asla kod içine sabit yazılmaz, ortam değişkeninden (`.env`) okunur.

### Uygulama notları — Faz 1, 2, 3, 4, 5 ve 6 (teknik)

- **Faz 6 (cari hesaplar) — tamamlandı**: migration `..._faz6_transactions_party_balances.sql`. **`categories` ve `transactions` tabloları (yalnızca şema + RLS + test) Faz 6'ya çekildi**, çünkü `party_balances` view'i ve cari detayı onlara bağlı; Faz 7 bunların üzerine Genel Kasa ekranını, kategori yönetimini, `site_cash_summary` view'ini, grafikleri ve dashboard kartlarını kurar. `transactions`: cari/personel/irsaliye bağlantıları `(id, site_id)` bileşik yabancı anahtar (irsaliye silinince yalnızca `goods_entry_id` boşalır: `ON DELETE SET NULL (goods_entry_id)`), `user_id` UUID (`ON DELETE SET NULL`), kategori şantiyeye ve TÜRE (gelir/gider) uygun olmalı (trigger `private.check_transaction_category`), `updated_at` otomatik. `categories.site_id IS NULL` = tüm şantiyelerde görünen varsayılan kategori (yalnızca service_role yazar; ortaklar yalnızca kendi şantiyesinin kategorilerini yönetir). `site_id`/`user_id` değiştirilemez.
- **Bakiye tanımı**: `party_balances` (security_invoker) `balance = tahsilat (income) − ödeme (expense)`, ayrıca `total_turnover`, `transaction_count`, `last_transaction_date`, `category`. Yeşil = tahsilat fazla, kırmızı = ödeme fazla (borç/alacak DEĞİL; irsaliyede tutar tutulmadığı için fatura bazlı borç hesabı yoktur — Faz 8'de irsaliye/personel ödemeleri `transactions`'a yansıyınca yeniden ele alınır). **Cari ödeme = gider (expense), tahsilat = gelir (income); cari hareketleri aynı zamanda Genel Kasa kayıtlarıdır.**
- Faz 6 ekranları: `sites/[siteId]/cari` (ad arama, kategori çipleri + sayılar, bakiye), `.../yeni`, `.../[partyId]` (ciro/tahsilat/ödeme/bakiye kartları, hareketler, sabit "Ödeme/Tahsilat Ekle"), `.../[partyId]/duzenle` (+ cari silme; bağlı kaydı olan cari silinemez). Hareket ekleme/düzenleme/silme penceresi `components/parties/party-transactions.tsx` (mobilde bottom-sheet, masaüstünde yan panel; **Faz 7'nin gelir/gider formu bu bileşenin genelleştirilmesiyle yapılmalı**, kategori seçimi eklenerek). Veri katmanı `lib/parties/{schemas,queries,actions}.ts`; `DataRow` artık `onClick` ile düğme olabilir.
- Faz 6 testleri: `npm run test:rls:transactions` (68 kontrol); tarayıcı testi 375/1280px (90 kontrol), kalıcı değil. Ölçüm: 20.000 hareket/300 cari ile cari listesi 24 ms.

- **Faz 5 (puantaj) — tamamlandı**: migration `..._faz5_attendance.sql`. `attendance`: `UNIQUE(personnel_id, work_date)`, personel **bileşik yabancı anahtar** `(personnel_id, site_id)` + `ON DELETE CASCADE`, `recorded_by` UUID, yalnızca `note` güncellenebilir, gelecek tarihe yazılamaz (RLS, Europe/Istanbul). `monthly_attendance_summary` view'i (`security_invoker`) duruyor ama ekranlar artık `get_month_attendance` RPC'sini kullanır. Yazma: `set_attendance(site, tarih, ekle[], çıkar[])` RPC'si (SECURITY INVOKER, atomik; **tam liste değil ekle/çıkar** gönderilir, böylece iki kişi aynı anda işaretlese birbirini ezmez; tekrar eklemeler yok sayılır).
- Puantaj ekranları: `sites/[siteId]/puantaj` — **Günlük Gelenler** (`components/attendance/daily-attendance.tsx`) ve **Aylık Özet** (`monthly-matrix.tsx` sunucu + `editable-matrix.tsx` istemci). **Tek gerçek kaynak sunucudur**: günlük ekran yalnızca EKLER (işaretli kişide seçim kutusu yerine "Geldi" rozeti; iptal matristen yapılır); matris bir güne dokunarak işaret koyar/kaldırır (iyimser güncelleme, hata olursa geri alır); her ikisinde "Geri al" (10 sn), günlükte kişiye kısa not, satırda "kim işaretledi · saat". İki ekran `useLiveRefresh` (`lib/use-live-refresh.ts`: odaklanınca/görünür olunca/15 sn) ile senkron tutulur. Viewer/admin yalnızca görüntüler.
- **Puantaj kuralı**: bir kişi bir tarihte listeye girer mi → `workAvailability` (`lib/personnel/status.ts`): işe giriş/çıkış tarihi, ayrıldı, izinli/raporlu/geçici görevde (geçmiş tarihler için de doğru). Uygun olmayanlar "listede yok" bölümünde nedenleriyle görünür; `saveAttendance` sunucuda da engeller. Dashboard "Bugün Gelen Personel" kartı `countPresent` ile gerçek veriye bağlıdır (gelir/gider kartları Faz 7'de).
- Faz 5 testleri: `npm run test:rls:attendance` (62 kontrol), `npm run test:status` (43 birim testi); tarayıcı testleri (375/1280px) yapıldı, kalıcı değil.
- **Performans (Faz 5 sonrası çalışma)** — ölçüm: Supabase'e tek tur ~150–400 ms olduğu için asıl maliyet **art arda ağ turları**ydı (ortalama geçiş 2.492 ms → 526 ms, tekrar ziyaret 97 ms). Kurallar:
  - **Kimlik ağa çıkmadan doğrulanır**: `getAuthUserId()` (`getClaims()`, ES256 JWT yerel). `getProfile` ve `getSiteRole(siteId)` bunu kullanır. Server action'larda profil gerekmiyorsa `requireAuthId()` (ağsız). `getUser()` kullanma.
  - **Her sayfa tüm verisini tek `Promise.all` ile ister**: `requireUser()` + rol + sayfa verisi paralel (`const [, role, data] = await Promise.all([requireUser(), getSiteRole(siteId), listX(siteId)])`). Art arda `await` ile veri çekme; her biri bir ağ turu ekler. Layout'lar da profil ve şantiye listesini paralel alır.
  - **RLS politikaları satır başı fonksiyon çağırmaz**: `site_id IN (SELECT private.member_site_ids())` / `writable_site_ids()` / `owner_site_ids()` ve `(SELECT private.is_admin())` (sorgu başına bir kez; 3.900 satır 478 ms → 3 ms). **Yeni operasyonel tabloların politikaları bu kalıbı kullanır**, `private.has_site_access(site_id)` gibi satır başı fonksiyonu politikada KULLANMA.
  - Büyük listeler için sayfalı çoklu istek yerine tek RPC (ör. `get_month_attendance`: kişi başına tek satır). PostgREST 1000 satır sınırı vardır.
  - İstemci önbelleği: `next.config.ts` `experimental.staleTimes { dynamic: 30, static: 180 }`; yazmalar `revalidatePath` ile tazeler (doğrulandı). `loading.tsx` iskeletleri var (`sites/[siteId]`, `(general)`, irsaliye, personel, puantaj).
  - İndeks: bileşik yabancı anahtar kapsayıcı indeksleri eklendi; `(site_id, full_name)` personel listesi için.
  - Ölçüm aracı: `SUPABASE_TIMING=1` ile başlatılan sunucu her Supabase çağrısının süresini günlüğe yazar (`lib/supabase/debug-fetch.ts`). Yeni ekran eklerken 375/1280 UX testine ek olarak sıralı çağrı sayısına bak.
  - Canlıda uygulamayı veritabanıyla aynı bölgede çalıştır (Vercel `dub1`).

- **Faz 4 (personel) — tamamlandı**: migration `..._faz4_personnel_payment_accounts.sql`. `personnel` (16 alan) + `payment_accounts` + `sensitive_access_log`. `personnel(id, site_id)` üzerinde `UNIQUE` vardır: attendance/transactions/payment_accounts `personnel_id`'yi **bileşik yabancı anahtarla** bağlar (Faz 3 deseni). Aynı şantiyede TC tekil (`uq_personnel_site_tc`). Personel silme yalnızca şantiye sahibi (silmek puantajı da siler; normal çıkış = durum "Ayrıldı").
- **Hassas veri (Bölüm 6, `tc_no` / `iban`)**: `authenticated` rolünün bu sütunlarda **SELECT yetkisi yoktur** (sütun düzeyi GRANT) — `select *` dahil hiçbir API cevabı gerçek değeri döndüremez; yalnızca `has_tc_no`/`has_iban` okunur. **Personel/payment_accounts sorgularında `select("*")` kullanma; sütunları tek tek yaz** ve write sorgularında `.select("id")` kullan. Gerçek değer `reveal_personnel_sensitive(id)` / `reveal_payment_iban(id)` RPC'leriyle ("Göster" düğmesi) yalnızca admin ve owner/partner'a açılır (viewer'a HAYIR) ve her erişim `sensitive_access_log`'a yazılır (günlüğü yalnızca admin okur; şu an okuma ekranı yok). Arayüz: `components/personnel/sensitive-field.tsx` — ●●●● varsayılan, "Göster" 30 sn sonra kendiliğinden gizler; mevcut değer forma HİÇ yüklenmez, yalnızca "Değiştir" ile yenisi girilir (`tcNoChanged`/`ibanChanged` bayrakları; değişmediyse sunucuya gönderilmez). IBAN doğrulaması mod-97, TC yalnızca 11 hane ve `0` ile başlamaz (yabancı kimlikler için sağlama algoritması uygulanmaz).
- **Personelin güncel durumu türetilir** (`lib/personnel/status.ts` — tek kaynak): veritabanında yalnızca `aktif`/`ayrildi` saklanır; İzinli/Raporlu/Geçici Görevde, izin/rapor/geçici görev **tarihlerinden ve bugünden (Europe/Istanbul)** hesaplanır: başlangıç ≤ bugün < bitiş; bitiş = sonraki dönemin başlangıcı, son dönem için işe dönüş tarihi (yoksa gün sayısı, o da yoksa açık uçlu); **dönüş gününde kişi aktiftir**; çıkış tarihi bugünden önceyse Ayrıldı; başlangıcı gelecekte olan dönem "yaklaşan" olarak gösterilir. **Puantajda (Faz 5) "o gün çalışabilir personel" bu fonksiyonla belirlenir; durumu `status` sütunundan okuma.** Türkçe küçük harf için `toLocaleLowerCase("tr-TR")` kullan. Test: `npm run test:status` (30 birim testi).
- Faz 4 ekranları: `sites/[siteId]/personel` (ad arama, güncel duruma göre filtre çipleri + sayılar), `.../yeni`, `.../[personId]` (yazma yetkilisine form, viewer/admin'e salt görüntüleme; admin "Göster" kullanabilir). Form `components/personnel/personnel-form.tsx` (dört grup, canlı "Bugünkü durum" önizlemesi). Veri katmanı `lib/personnel/{schemas,actions,queries,status}.ts`. Ortak firma seçici `components/party-picker.tsx`.
- Faz 4 testleri: `npm run test:rls:personnel` (80 kontrol); tarayıcı testi (375/1280px) yapıldı, kalıcı değil. **`payment_accounts` için ekran yapılmadı** (tarifte yok); tablo, RLS ve RPC hazır ve testli. Bir Next.js tuzağı: sunucu bileşeninden istemci bileşenine fonksiyon (ör. `onChange`) geçirilemez; `next build` `scripts/` klasörünü de tip denetiminden geçirir.

- **Faz 3 (irsaliye/fatura/fiş) — tamamlandı**: migration `..._faz3_parties_goods_entries.sql`. `parties` + `goods_entries`; `goods_entries.party_id` **bileşik yabancı anahtarla** `(party_id, site_id) → parties(id, site_id)` bağlıdır (başka şantiyenin firması bağlanamaz). **Sonraki fazlarda `party_id`/`personnel_id` taşıyan her tablo aynı deseni kullanır** (hedef tabloda `UNIQUE (id, site_id)`). `parties` adı şantiye içinde tekildir (`lower(name)` unique index). Yazma yetkisi `private.can_write_site(site_id)` (yalnızca owner/partner); okuma `private.has_site_access`. Admin ve viewer veri yazamaz. UPDATE yetkisi sütun bazlıdır; `site_id`/`created_by` değiştirilemez.
- Faz 3 ekranları: `sites/[siteId]/irsaliye` (firma bazlı / tarih sırası liste, en yeni 300 kayıt), `.../yeni`, `.../[entryId]` (düzenle + sil). Form `components/goods/goods-entry-form.tsx`: mobilde 4 adımlı stepper, masaüstünde bölümlü; yalnızca tarih ve belge türü zorunlu (şemadaki NOT NULL). Veri katmanı `lib/goods/{schemas,actions,queries}.ts`. Form içinden hızlı firma ekleme vardır; tam cari CRUD Faz 6'dadır. Ortak liste satırı `components/data-row.tsx` (`DataRow`) — sonraki listeler (personel, cari, kasa) bunu kullanır. Rol yardımcıları `lib/sites/queries.ts`: `getSiteRole`, `canWriteRole`.
- Faz 3 testleri: `npm run test:rls:goods` (42 kontrol, 6 hesap). UX testi 375/1280px gerçek tarayıcıyla (Edge + Playwright) yapıldı; script kalıcı değil. Yeni ekranlarda aynı kontrol: yatay taşma yok, dokunma alanları ≥44px, boş/yükleniyor/hata durumları, konsol hatası yok.
- Uyarı: `next start` ile test ederken eski süreç portta kalırsa eski derlemeyi sunar (CSS 500 döner); testten önce portu boşalt ve yeniden build al.

- Next.js **16**: `middleware.ts` yerine `src/proxy.ts` (oturum yenileme + girişsiz kullanıcıyı `/login`'e yönlendirme). Kod yazmadan önce `node_modules/next/dist/docs/` okunur (bkz. AGENTS.md).
- Supabase istemcileri `src/lib/supabase/`: `client.ts` (tarayıcı), `server.ts` (sunucu), `admin.ts` (**service_role**; yalnızca `createPartner` ve seed script'i). Kimlik için `getUser()`/`getClaims()`; sunucuda `getSession()` güvenilmez.
- `src/lib/auth/session.ts`: `requireUser()` (giriş + `must_change_password` yönlendirmesi), `requireAdmin()`. Her admin sayfası kendi başına `requireAdmin()` çağırır (layout tek başına yeterli değildir).
- **Yetki modeli veritabanındadır (RLS)**; server action'lardaki kontroller yalnızca anlaşılır hata mesajı içindir. RLS yardımcıları `private` şemasında: `is_admin()`, `has_site_access(site_id)`, `is_site_owner(site_id)`, `is_site_creator(site_id)`, `site_has_members(site_id)`, `is_partner(user_id)`, `shares_site_with(user_id)`. Yeni operasyonel tabloların politikaları `private.has_site_access(site_id)` kullanır (admin SELECT, üyeler tüm işlemler; **admin veri yazmaz**).
- Şantiye/üye politikaları (migration `..._faz2b_owner_based_site_policies.sql`): `sites` INSERT herkes (`created_by = auth.uid()`) **admin hariç**; `site_members` INSERT = ilk üye olarak kendini owner ekleme (yalnızca oluşturan, üyesi yokken) veya owner'ın başka bir **ortağı** partner/viewer olarak eklemesi (admin hesabı ve owner rolü verilemez); DELETE = owner, owner olmayan üyeleri çıkarır; `sites` UPDATE yalnızca owner ve yalnızca ad/adres/tarih/durum; `sites` silinemez. `users` tablosunda `authenticated` yalnızca `full_name, phone, must_change_password` günceller.
- RPC'ler (public): `create_site(name, address, start_date)` — SECURITY INVOKER, şantiye + owner üyeliği tek işlemde, RLS aynen geçerli; `search_users_for_site(site_id, query)` — SECURITY DEFINER, yalnızca o şantiyenin owner'ı çağırabilir, sadece ortak hesapları, mevcut üyeler hariç, ≥2 karakter, en fazla 10 sonuç (Supabase advisor'ında "SECURITY DEFINER fonksiyonu çağrılabilir" uyarısı bilinçli ve beklenendir).
- Bu Supabase projesinde tablo yetkileri otomatik verilmez: her yeni tabloda `authenticated` ve `service_role` için GRANT açıkça yazılır; `anon`'a hiçbir yetki verilmez.
- Route yapısı: `(auth)/login`, `(auth)/forgot-password`, `change-password`, `auth/callback`; `(general)/admin` (+ `ortaklar`, `ortaklar/yeni`, `santiyeler` salt okunur liste/detay); `(general)/sites` (seçim), `(general)/sites/yeni`; `sites/[siteId]` (dashboard), `sites/[siteId]/ortaklar` (B2). Henüz teslim edilmeyen menü öğeleri "Yakında" olarak devre dışıdır.
- Server action'lar: `lib/admin/actions.ts` (`createPartner`), `lib/sites/actions.ts` (`createSite`, `searchUsersForSite`, `addSiteMember`, `removeSiteMember`); zod şemaları yanlarında ve **sunucuda yeniden doğrulanır**.
- Yeni ortak: admin geçici şifreyi girer veya "Oluştur" ile üretir; şifre yalnızca oluşturma sonrası bilgi kartında bir kez gösterilir. `must_change_password = true`.
- Dashboard özet kartları (`components/dashboard/summary-cards.tsx`) kasa/puantaj tabloları olmadığı için `null` → "—" gösterir; sahte 0 yazılmaz. **Faz 5 (puantaj) ve Faz 7 (kasa)'da `sites/[siteId]/page.tsx` içindeki `null` değerler gerçek sorgularla bağlanacak.** Şantiye seçim kartlarındaki "bu ay net bakiye" özeti de Faz 7'de eklenecek.
- Biçimlendirme tek noktadan: `src/lib/format.ts` (`formatCurrency` → ₺12.500,00, `formatDate` → GG.AA.YYYY). Sabit alt Kaydet çubuğu: `components/layout/sticky-action-bar.tsx`. shadcn/ui Base UI tabanlıdır (`base-nova`); `cn` = `clsx + tailwind-merge` (`src/lib/utils.ts`).
- İlk admin: `npm run create-first-admin` (`.env.local`: `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` ≥10 karakter, `ADMIN_FULL_NAME`); sonra `ADMIN_*` değerleri `.env.local`'dan silinir.
- **Güvenlik testi**: `npm run test:rls` (`scripts/test-rls-sites.mts`) geçici hesaplarla 2 ortak + admin senaryosunu gerçek oturumlarla dener ve kendini temizler; her fazda ilgili tabloların kontrolleri buraya (veya yanına) eklenir.

## 7. Arayüz (UI/UX) Tasarım Kuralları

Bu bölüm bağlayıcıdır — Claude Code her ekranı yazarken burada tarif edilen düzeni, bileşenleri ve mobil davranışı uygular. Görsel bir mockup önceden hazırlanmadı; ekranlar doğrudan bu tarife göre kodlanacak.

### 7.1 Genel tasarım ilkeleri

- **Mobile-first**: her bileşen önce 375–414px genişlik için tasarlanır, sonra `md:`/`lg:` breakpoint'leriyle tablet/masaüstüne genişletilir. Şantiyede sahada telefonla kullanılacağı için bu zorunludur.
- **Tek elle kullanım**: birincil eylem butonları (Kaydet, Ekle) ekranın altında, başparmakla ulaşılabilir sabit bir çubukta durur (mobilde `fixed bottom-0`), formun en üstünde değil.
- **Büyük dokunma alanları**: tüm buton/etkileşim alanları en az 44×44px. Sahada eldivenli/telefonla tek elle kullanım göz önünde bulundurulur.
- **Sayısal klavye**: tutar, miktar, telefon, TC no, IBAN alanları `inputMode="numeric"` veya ilgili tip ile açılır — mobilde doğru klavye çıkar.
- **Boş durumlar (empty state)**: hiç veri yokken ekran boş bırakılmaz; "Henüz irsaliye eklenmedi" + doğrudan "İlk kaydı ekle" butonu gösterilir.
- **Yükleniyor/hata durumları**: her liste ve form için iskelet (skeleton) yükleme durumu ve anlaşılır hata mesajı zorunlu ("Kayıt eklenemedi, bağlantınızı kontrol edin" gibi net dil, teknik hata kodu değil).
- **Renk kodlaması**: gelir yeşil tonu, gider kırmızı/turuncu tonu ile tutarlı şekilde her ekranda (özet kartları, tablo satırları, grafikler) aynı anlamda kullanılır.
- **Tutarlı tarih/para formatı**: tarihler `GG.AA.YYYY`, para birimi `₺12.500,00` formatında, tüm uygulamada tek bir formatlama fonksiyonundan geçirilir.

### 7.2 Navigasyon yapısı

**Mobilde (< 768px)**: alt sabit navigasyon çubuğu (bottom tab bar), 5 sekmeyi geçmez:
`Ana Sayfa` · `Kasa` · `Puantaj` · `Cari` · `Daha Fazla` (İrsaliye, Personel, Raporlar buraya toplanır)

**Masaüstünde (≥ 768px)**: sol tarafta daraltılabilir bir kenar çubuğu (sidebar), üstte aktif şantiyenin adı + şantiye değiştirme dropdown'ı sabit durur.

**Şantiye bağlamı her zaman görünür**: hangi ekranda olursa olsun, ekranın en üstünde aktif şantiyenin adı bir "chip" olarak durur; buna dokunmak şantiye değiştirme listesini açar. Kullanıcı hangi şantiyede olduğunu asla kaybetmemelidir — bu modülerlik gereksiniminin arayüzdeki karşılığıdır.

### 7.3 Ekran ekran tarif

**A. Giriş ekranı**
Tek sütun, ortalanmış form (e-posta + şifre), altında "Şifremi unuttum". Rol (admin/partner) kullanıcıya sorulmaz — giriş sonrası otomatik yönlendirilir.

**B. Şantiye seçim ekranı** (partner girişinden sonra)
Kart listesi: her kart bir şantiyenin adını, kısa özetini (ör. bu ayki net bakiye) gösterir. En altta "+ Yeni Şantiye Ekle" kartı — **her ortak bu işlemi kendi panelinden yapabilir, admin yetkisi gerekmez**; oluşturan kişi otomatik olarak o şantiyenin owner'ı olur. Tek şantiyesi olan kullanıcı bu ekranı hiç görmez, doğrudan o şantiyenin ana sayfasına düşer.

**B2. Şantiye Ortakları** (site owner'ın erişebildiği bir ayar ekranı)
Bir şantiyenin owner'ı, o şantiyenin panelinde "Şantiye Ortakları" bölümünden sistemde zaten hesabı olan bir ortağı arayıp o şantiyeye üye olarak ekleyebilir (rolünü partner/viewer olarak belirler). Bu ekran admin panelinde DEĞİL, ortağın kendi şantiye panelindedir.

**C. Şantiye ana sayfası (dashboard)**
Üstte 4 özet kart (yatay kaydırmalı mobilde, grid masaüstünde): Bu Ay Gelir, Bu Ay Gider, Net Bakiye, Bugün Gelen Personel Sayısı. Altında son 5 kasa hareketi ve "Tümünü Gör" linki. En altta hızlı eylem butonları: "Gelir/Gider Ekle", "Günlük Gelenler", "İrsaliye Ekle".

**D. Genel Kasa (Finans Merkezi)**
Üstte gün/ay filtre çubuğu (segment control: Bugün / Bu Hafta / Bu Ay / Özel Aralık). Sağ üstte sabit "+ Gelir/Gider Ekle" butonu (mobilde sağ alt köşede yüzen buton — FAB). Liste: her satır tarih, açıklama, kategori etiketi, tutar (renkli), kim girdiği. Listenin üstünde kategori dağılımı yatay bar grafik. Gelir/Gider ekleme formu bottom-sheet (mobil) veya modal (masaüstü) olarak açılır — sayfa değiştirmeden hızlı giriş sağlanır.

**E. Günlük Gelenler (Puantaj)**
Üstte tarih seçici (varsayılan: bugün). Altında o şantiyedeki tüm aktif personelin listesi, her biri yanında büyük bir onay kutusu (checkbox) — dokunulunca "geldi" işaretlenir, tekrar dokunulunca kaldırılır. Liste alfabetik veya göreve göre gruplanabilir. Alt sabit çubukta "X kişi işaretlendi — Kaydet". Aylık görünüme geçiş için üstte "Aylık Özet" sekmesi: personel × gün matrisi (yatay kaydırmalı tablo), her personelin o ay kaç gün geldiği sağda toplam sütununda.

**F. Cari Hesaplar**
Liste: her satır cari adı, kategori etiketi (Firma/Nakliyeci/Araç/Müşteri), güncel bakiye (borçluysa kırmızı, alacaklıysa yeşil). Üstte arama kutusu + kategori filtre çipleri. Bir cariye dokununca detay sayfası: üstte toplam ciro + bakiye kartı, altında o cariye ait tüm hareketlerin kronolojik listesi (tarih, açıklama, tutar, not), en altta "Ödeme/Tahsilat Ekle" butonu.

**G. İrsaliye/Fatura Girişi**
Form, mantıksal gruplara bölünmüş (tek uzun form yerine): 1) Belge Bilgisi (tarih, tür, no), 2) Firma ve Malzeme (firma seç, malzeme türü, birim, çeşit, miktar), 3) Lokasyon ve Maliyet (kullanıldığı yer, satın alma yeri, nakliye tutarı), 4) Not. Mobilde bu gruplar adım adım (stepper) gösterilir; masaüstünde tek sayfada bölümlenmiş olarak.

**H. Personel Yönetimi**
Liste: ad soyad, işi/görevi, durum etiketi (Aktif/İzinli/Raporlu/Ayrıldı — renkli rozet). Personel detayına girince tüm 16 alan düzenlenebilir gruplar halinde (Kimlik Bilgileri, İstihdam Bilgileri, Durum/İzin Bilgileri, Ödeme Bilgileri). `tc_no` ve `iban` alanları varsayılan gizli gösterilir (●●●●●●●●), "Göster" dokunmasıyla açılır — yanlışlıkla omuz sörfüne karşı.

**I. Raporlar**
Üstte dönem seçici, altında sekmeli görünüm: Genel Trend (gelir-gider çizgi grafik), Kategori Dağılımı (pasta/bar), Cari Bazlı (en çok borçlu/alacaklı carilerin listesi), Personel Bazlı (en çok çalışan gün listesi). Her sekmenin sağ üstünde "Dışa Aktar" (PDF/Excel) butonu.

### 7.4 Bileşen tutarlılığı

Tüm formlar `react-hook-form` + `zod` ile aynı doğrulama/hata gösterme desenini kullanır (hata mesajı ilgili alanın hemen altında, kırmızı, ikon ile). Tüm listeler aynı kart/satır bileşenini paylaşır (`shadcn/ui` üzerine kurulu ortak `DataRow` bileşeni) — irsaliye, cari, personel, kasa hareketi listeleri görsel olarak birbirinin tutarlı varyasyonu olmalı, birbirinden bağımsız tasarlanmamalı.

## 8. İş Akışı — Fazlar

Claude Code'a görevleri bu sırayla ver; bir fazı bitirip test etmeden bir sonrakine geçme. Her faz hem veritabanı/mantık hem de Bölüm 7'de tarif edilen ilgili ekran(lar)ı birlikte teslim eder — önce şema, sonra o şemaya bağlı ekran.

**Durum (2026-09-26):** Faz 1, 2, 3, 4, 5 ve 6 tamamlandı ve onaylandı; **sıradaki: Faz 7 (Genel Kasa)**. Ayrıca performans çalışması yapıldı (aşağıdaki "Performans" notları). **Açık kararlar:** (1) Supabase bölgesi şimdilik `eu-west-1` (Irlanda) kalıyor; canlıya alırken Vercel fonksiyon bölgesi Dublin (`dub1`) seçilecek — Supabase'i taşımak gerekirse migration dosyalarıyla yeni projeye kurulur, ama kullanıcı hesapları/veri ayrıca taşınır (gerçek veri girilmeden önce karar vermek en ucuzu). (2) Canlıya alma kontrol listesi: kodu GitHub'a push, Vercel ortam değişkenleri (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`), Supabase Auth → URL Configuration'a Vercel adresi, "leaked password protection" aç, test verilerini temizle, gerçek admini oluştur, Vercel ticari kullanım planı. Bir fazı kullanıcı "tamam, diğer faza geçelim" diyene kadar tamamlanmış işaretleme; o zaman bu durum satırını ve ilgili faz notlarını güncelle.

1. ✅ **Faz 1 — Temel altyapı**: `users`, `sites`, `site_members` migration'ları + Supabase Auth entegrasyonu + admin/partner rol ayrımı + temel RLS politikaları. **Ekran**: Giriş ekranı (7.3-A), mobil alt navigasyon + masaüstü sidebar iskeleti (7.2).
2. ✅ **Faz 2 — Şantiye seçimi ve panel iskeleti**: admin panelinde SADECE "Yeni Ortak Ekle" (kullanıcı hesabı oluşturma) formu ve tüm ortak/şantiyelerin salt-görüntüleme listesi; ortak panelinde "Yeni Şantiye Ekle" (kendi şantiyesini oluşturma, otomatik owner ataması) ve "Şantiye Ortakları" (mevcut bir ortağı şantiyeye üye ekleme). Admin panelinde şantiye oluşturma veya site_members'a satır ekleme YAPILMAZ. **Ekran**: Şantiye seçim ekranı + B2 (7.3-B, 7.3-B2), şantiye ana sayfası/dashboard iskeleti (7.3-C, boş veri durumlarıyla).
3. ✅ **Faz 3 — İrsaliye/Fatura girişi**: `parties` + `goods_entries` migration'ları. **Ekran**: İrsaliye giriş formu — mobilde adım adım, masaüstünde bölümlü (7.3-G), firma bazlı listeleme.
4. ✅ **Faz 4 — Personel yönetimi**: `personnel` + `payment_accounts` migration'ları, `tc_no`/`iban` için erişim kısıtlaması. **Ekran**: Personel listesi + detay/düzenleme ekranı, gizli alan (●●●●) davranışı (7.3-H).
5. ✅ **Faz 5 — Puantaj**: `attendance` migration'ı, `monthly_attendance_summary` view'i. **Ekran**: Günlük Gelenler (çoklu seçim + sabit Kaydet çubuğu) ve Aylık Özet matrisi (7.3-E).
6. ✅ **Faz 6 — Cari hesaplar**: `parties` üzerinde CRUD + `party_balances` view'i. **Ekran**: Cari listesi (arama + kategori çipleri) ve cari detay sayfası (7.3-F).
7. **Faz 7 — Genel kasa / finans merkezi**: `categories` + `transactions` migration'ları, `site_cash_summary` view'i. **Ekran**: Genel Kasa ekranı — filtre çubuğu, FAB ile gelir/gider ekleme bottom-sheet/modal, kategori dağılım grafiği (7.3-D), dashboard'daki özet kartlarının gerçek veriyle bağlanması (7.3-C).
8. **Faz 8 — Entegrasyon ve raporlama**: irsaliye/personel ödemelerinin `transactions`'a otomatik yansıması, PDF/Excel dışa aktarım. **Ekran**: Raporlar sekmeli görünümü (7.3-I).

Her fazın sonunda iki kontrol zorunludur:
1. **Güvenlik testi**: bu fazda yazılan RLS politikalarını iki farklı ortak hesabıyla test et, bir ortağın diğerinin şantiye verisini göremediğini doğrula.
2. **UX testi**: ilgili ekranı 375px (mobil) ve 1280px (masaüstü) genişlikte kontrol et — dokunma alanları, boş/yükleniyor/hata durumları ve Bölüm 7.1'deki ilkeler eksiksiz uygulanmış olmalı.