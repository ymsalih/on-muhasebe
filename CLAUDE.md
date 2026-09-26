# Şantiye Ön Muhasebe Projesi — CLAUDE.md

Bu dosya, Claude Code'un bu projede her oturumda otomatik okuduğu proje hafızasıdır. Yeni bir oturum başladığında önce bu dosyayı oku, sonra göreve başla. Mimariyi ve aşağıdaki kuralları değiştirmeden önce kullanıcıya sor.

## 1. Proje Özeti

Birden fazla ortağın (ör. Veysel, ve diğer ortaklar) kendi kullanıcı adı/e-posta ve şifresiyle giriş yaptığı, her ortağın birden çok şantiyeyi yönetebildiği, tam kapsamlı ve modüler bir **şantiye ön muhasebe sistemi**.

Temel prensip — **modülerlik**: bir ortak yeni bir şantiye eklediğinde, o şantiyeye ait tüm veriler (irsaliye, personel, puantaj, cari hesap, kasa hareketleri) diğer şantiyelerden tamamen izole tutulur. Aynı ekran/akış her şantiye için tekrar kullanılır, veri karışmaz.

İkinci prensip — **rol ayrımı**:
- **Admin paneli**: tüm ortakları ve tüm şantiyeleri genel olarak görebilir, yeni ortak ekleyip ona özel bir panel açabilir.
- **Ortak paneli**: giriş yapan ortak, önce erişebildiği şantiyelerden birini seçer, sonra o şantiyenin panelinde çalışır. Örnek senaryo: Veysel giriş yapar → şantiyelerinden birini seçer → o şantiyeye özel irsaliye/personel/cari/kasa işlemlerini yapar → başka bir şantiye seçtiğinde tamamen farklı, izole bir veri seti görür.

## 2. Teknoloji Yığını

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (Postgres + Auth + Row Level Security) — ayrı bir backend yazılmaz, yetkilendirme veritabanı seviyesinde RLS ile yapılır
- TanStack Query — veri çekme/önbellekleme
- react-hook-form + zod — form doğrulama
- Recharts — raporlama/analiz grafikleri

## 3. Roller ve Yetkilendirme Mantığı

- `users.role`: `admin` veya `partner`.
- `site_members` tablosu, hangi kullanıcının hangi şantiyeye erişebildiğini tutar (çok-çok ilişki). Yeni bir ortak eklemek veya bir ortağa yeni bir şantiye açmak, bu tabloya satır eklemekten ibarettir — şema değişmez.
- **Admin**: `site_members`'tan bağımsız, tüm `sites` ve tüm ilişkili verileri görebilir; yeni kullanıcı/şantiye oluşturabilir.
- **Partner**: yalnızca `site_members` üzerinden üyesi olduğu `site_id`'lere ait verileri görebilir. Erişim kontrolü Supabase RLS politikalarıyla veritabanı seviyesinde uygulanır; uygulama kodunda ayrıca yetki kontrolü tekrar yazılmaz.
- Her operasyonel tablo (`goods_entries`, `personnel`, `attendance`, `parties`, `transactions` vb.) bir `site_id` sütunu taşır — modülerliğin temeli budur.

## 4. Veritabanı Şeması

```sql
-- ============================================================
-- KULLANICILAR VE ŞANTİYELER
-- ============================================================

-- FAZ 1'DE UYGULANDI (supabase/migrations/20260926091139_*.sql ve ..._grant_service_role.sql).
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

### Faz 1 uygulama notları (teknik)

- Next.js **16**: `middleware.ts` yerine `src/proxy.ts` kullanılır (oturum yenileme + girişsiz kullanıcıyı `/login`'e yönlendirme). Kod yazmadan önce `node_modules/next/dist/docs/` okunur (bkz. AGENTS.md).
- Supabase istemcileri `src/lib/supabase/`: `client.ts` (tarayıcı), `server.ts` (sunucu), `admin.ts` (**service_role**, yalnızca sunucuda ve `requireAdmin()` sonrası). Kimlik doğrulama için `getUser()`/`getClaims()`; sunucuda `getSession()` güvenilmez.
- Yetki yardımcıları `src/lib/auth/session.ts`: `requireUser()` (giriş + `must_change_password` yönlendirmesi), `requireAdmin()`. RLS yardımcıları `private` şemasında: `is_admin()`, `has_site_access(site_id)`, `is_site_owner(site_id)`, `shares_site_with(user_id)`. Yeni operasyonel tabloların politikaları `private.has_site_access(site_id)` kullanır.
- `users` tablosunda `authenticated` rolü yalnızca `full_name, phone, must_change_password` sütunlarını güncelleyebilir; rol değişikliği ve kullanıcı oluşturma yalnızca service_role ile. `sites`/`site_members` yazma: admin (`sites` güncelleme: admin veya `owner`).
- Bu Supabase projesinde tablo yetkileri otomatik verilmez: her yeni tabloda `authenticated` ve `service_role` için GRANT açıkça yazılır; `anon`'a hiçbir yetki verilmez.
- Route yapısı: `(auth)/login`, `(auth)/forgot-password`, `change-password`, `auth/callback`, `(general)/admin`, `(general)/sites`, `sites/[siteId]/...` (şantiye paneli: `AppShell` — şantiye chip'i + sidebar + alt bar). Henüz teslim edilmeyen menü öğeleri "Yakında" olarak devre dışıdır.
- shadcn/ui bu projede Base UI tabanlıdır (`base-nova`); `cn` yardımcısı `clsx + tailwind-merge` ile `src/lib/utils.ts`'tedir.
- İlk admin: `npm run create-first-admin` (`.env.local`: `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` ≥10 karakter, `ADMIN_FULL_NAME`). Çalıştırdıktan sonra `ADMIN_*` değerleri `.env.local`'dan silinir.

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
Kart listesi: her kart bir şantiyenin adını, kısa özetini (ör. bu ayki net bakiye) gösterir. En altta "+ Yeni Şantiye Ekle" kartı (yetkisi varsa). Tek şantiyesi olan kullanıcı bu ekranı hiç görmez, doğrudan o şantiyenin ana sayfasına düşer.

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

1. **Faz 1 — Temel altyapı**: `users`, `sites`, `site_members` migration'ları + Supabase Auth entegrasyonu + admin/partner rol ayrımı + temel RLS politikaları. **Ekran**: Giriş ekranı (7.3-A), mobil alt navigasyon + masaüstü sidebar iskeleti (7.2).
2. **Faz 2 — Şantiye seçimi ve panel iskeleti**: admin panelinin genel görünümü, yeni ortak/şantiye ekleme akışı. **Ekran**: Şantiye seçim ekranı (7.3-B), şantiye ana sayfası/dashboard iskeleti (7.3-C, boş veri durumlarıyla).
3. **Faz 3 — İrsaliye/Fatura girişi**: `parties` + `goods_entries` migration'ları. **Ekran**: İrsaliye giriş formu — mobilde adım adım, masaüstünde bölümlü (7.3-G), firma bazlı listeleme.
4. **Faz 4 — Personel yönetimi**: `personnel` + `payment_accounts` migration'ları, `tc_no`/`iban` için erişim kısıtlaması. **Ekran**: Personel listesi + detay/düzenleme ekranı, gizli alan (●●●●) davranışı (7.3-H).
5. **Faz 5 — Puantaj**: `attendance` migration'ı, `monthly_attendance_summary` view'i. **Ekran**: Günlük Gelenler (çoklu seçim + sabit Kaydet çubuğu) ve Aylık Özet matrisi (7.3-E).
6. **Faz 6 — Cari hesaplar**: `parties` üzerinde CRUD + `party_balances` view'i. **Ekran**: Cari listesi (arama + kategori çipleri) ve cari detay sayfası (7.3-F).
7. **Faz 7 — Genel kasa / finans merkezi**: `categories` + `transactions` migration'ları, `site_cash_summary` view'i. **Ekran**: Genel Kasa ekranı — filtre çubuğu, FAB ile gelir/gider ekleme bottom-sheet/modal, kategori dağılım grafiği (7.3-D), dashboard'daki özet kartlarının gerçek veriyle bağlanması (7.3-C).
8. **Faz 8 — Entegrasyon ve raporlama**: irsaliye/personel ödemelerinin `transactions`'a otomatik yansıması, PDF/Excel dışa aktarım. **Ekran**: Raporlar sekmeli görünümü (7.3-I).

Her fazın sonunda iki kontrol zorunludur:
1. **Güvenlik testi**: bu fazda yazılan RLS politikalarını iki farklı ortak hesabıyla test et, bir ortağın diğerinin şantiye verisini göremediğini doğrula.
2. **UX testi**: ilgili ekranı 375px (mobil) ve 1280px (masaüstü) genişlikte kontrol et — dokunma alanları, boş/yükleniyor/hata durumları ve Bölüm 7.1'deki ilkeler eksiksiz uygulanmış olmalı.
