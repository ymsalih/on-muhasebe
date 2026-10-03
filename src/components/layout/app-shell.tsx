"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  ChevronsUpDown,
  FileText,
  HardHat,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  Truck,
  Fuel,
  PanelLeftClose,
  PanelLeftOpen,
  UserPlus,
  Users,
  Wallet,
  BarChart3,
  ClipboardCheck,
  BookUser,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/brand-logo";
import { signOut } from "@/lib/auth/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** false: ilgili faz henüz teslim edilmedi — "Yakında" olarak devre dışı gösterilir. */
  enabled: boolean;
  /** Tam eşleşme gerektiren kök rota (ör. Ana Sayfa). */
  exact?: boolean;
};

type SiteRef = { id: number; name: string };

type AppShellProps = {
  user: { fullName: string; role: "admin" | "partner" };
  /** Aktif şantiye (şantiye panelinde). Yoksa admin/genel görünüm. */
  site?: SiteRef;
  /** Kullanıcının erişebildiği şantiyeler (şantiye değiştirme listesi). */
  sites: SiteRef[];
  children: React.ReactNode;
};

function buildNav(site: SiteRef | undefined, role: "admin" | "partner") {
  if (site) {
    const base = `/sites/${site.id}`;
    return {
      // Mobil alt çubukta görünen ana sekmeler (Daha Fazla hariç 4 adet)
      primary: [
        { href: base, label: "Ana Sayfa", icon: LayoutDashboard, enabled: true, exact: true },
        { href: `${base}/kasa`, label: "Kasa", icon: Wallet, enabled: true },
        { href: `${base}/puantaj`, label: "Puantaj", icon: ClipboardCheck, enabled: true },
        { href: `${base}/cari`, label: "Cari", icon: BookUser, enabled: true },
      ] satisfies NavItem[],
      // "Daha Fazla" içine toplanan ekranlar
      more: [
        { href: `${base}/ortaklar`, label: "Şantiye Ortakları", icon: UserPlus, enabled: true },
        { href: `${base}/irsaliye`, label: "İrsaliye", icon: FileText, enabled: true },
        { href: `${base}/personel`, label: "Personel", icon: Users, enabled: true },
        { href: `${base}/malzeme`, label: "Malzeme", icon: Package, enabled: true },
        { href: `${base}/hakedis`, label: "Hakediş ve Fatura", icon: Receipt, enabled: true },
        { href: `${base}/makine`, label: "İş Makineleri", icon: Truck, enabled: true },
        { href: `${base}/yakit`, label: "Yakıt Takibi", icon: Fuel, enabled: true },
        { href: `${base}/raporlar`, label: "Raporlar", icon: BarChart3, enabled: true },
        { href: "/sirket", label: "Şirket Kasası", icon: Landmark, enabled: true },
      ] satisfies NavItem[],
    };
  }

  if (role === "admin") {
    return {
      primary: [
        { href: "/admin", label: "Genel Bakış", icon: LayoutDashboard, enabled: true, exact: true },
        { href: "/admin/ortaklar", label: "Ortaklar", icon: Users, enabled: true },
        { href: "/admin/santiyeler", label: "Şantiyeler", icon: Building2, enabled: true },
        { href: "/admin/sirketler", label: "Şirket Kasaları", icon: Landmark, enabled: true },
        { href: "/sites", label: "Panele Git", icon: HardHat, enabled: true, exact: true },
      ] satisfies NavItem[],
      more: [] as NavItem[],
    };
  }

  return {
    primary: [
      { href: "/sites", label: "Şantiyeler", icon: Building2, enabled: true, exact: true },
      { href: "/sirket", label: "Şirket Kasası", icon: Landmark, enabled: true },
    ] satisfies NavItem[],
    more: [] as NavItem[],
  };
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLink({
  item,
  active,
  collapsed,
  layout,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  layout: "sidebar" | "tab" | "sheet";
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const base =
    layout === "tab"
      ? "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
      : "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium";

  if (!item.enabled) {
    return (
      <span
        aria-disabled="true"
        title="Yakında"
        className={cn(base, "cursor-not-allowed text-muted-foreground/50", collapsed && "justify-center px-0")}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className={cn(collapsed && "sr-only")}>{item.label}</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        base,
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
        layout !== "tab" && active && "bg-muted",
        layout !== "tab" && !active && "hover:bg-muted/60",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <span className={cn(collapsed && "sr-only")}>{item.label}</span>
    </Link>
  );
}

function SignOutButton({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          collapsed && "justify-center px-0",
          className,
        )}
        title={collapsed ? "Çıkış Yap" : undefined}
      >
        <LogOut className="size-5 shrink-0" aria-hidden />
        <span className={cn(collapsed && "sr-only")}>Çıkış Yap</span>
      </button>
    </form>
  );
}

/** Aktif şantiye "chip"i — her ekranın en üstünde; dokunulunca şantiye değiştirme listesi açılır. */
function SiteChip({ site, sites }: { site: SiteRef; sites: SiteRef[] }) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full border bg-card px-3.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Aktif şantiye: ${site.name}. Değiştirmek için dokunun`}
      >
        <HardHat className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="truncate">{site.name}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        {sites.map((s) => (
          <DropdownMenuItem
            key={s.id}
            className="min-h-11"
            onClick={() => router.push(`/sites/${s.id}`)}
          >
            <span className={cn("truncate", s.id === site.id && "font-semibold")}>{s.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" onClick={() => router.push("/sites")}>
          Tüm şantiyeler
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ user, site, sites, children }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const nav = buildNav(site, user.role);
  const allItems = [...nav.primary, ...nav.more];

  return (
    <div className="flex min-h-dvh bg-muted/30">
      {/* Masaüstü: daraltılabilir sidebar (≥ 768px) */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-background transition-[width] md:flex",
          collapsed ? "w-[4.5rem]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center gap-2 border-b px-4", collapsed && "justify-center px-0")}>
          <BrandMark className="h-10 w-12 rounded-lg p-1 ring-1 ring-border" imgClassName="h-full w-full object-contain" sizes="48px" />
          <span className={cn("truncate text-base font-semibold tracking-wide", collapsed && "sr-only")}>ÖZN YOL</span>
        </div>
        <nav aria-label="Ana menü" className="flex-1 space-y-1 overflow-y-auto p-3">
          {allItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item)}
              collapsed={collapsed}
              layout="sidebar"
            />
          ))}
        </nav>
        <div className="space-y-1 border-t p-3">
          {!collapsed && (
            <p className="truncate px-3 pb-1 text-xs text-muted-foreground">
              {user.fullName} · {user.role === "admin" ? "Admin" : "Ortak"}
            </p>
          )}
          <SignOutButton collapsed={collapsed} />
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-5" aria-hidden />
                <span>Daralt</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Üst çubuk: şantiye bağlamı her zaman görünür */}
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          {/* Telefonda kenar çubuğu yok: logo üst çubukta (masaüstünde kenar çubuğunda) */}
          <BrandMark className="h-10 w-12 rounded-lg p-1 ring-1 ring-border md:hidden" imgClassName="h-full w-full object-contain" sizes="48px" />
          {site ? (
            <SiteChip site={site} sites={sites} />
          ) : (
            <span className="text-base font-semibold">{user.role === "admin" ? "Admin Paneli" : "Şantiyelerim"}</span>
          )}
        </header>

        <main className="flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-8">{children}</main>
      </div>

      {/* Mobil: alt sabit navigasyon (< 768px), en fazla 5 sekme */}
      <nav
        aria-label="Ana menü"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {nav.primary.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} layout="tab" />
        ))}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground">
            <Menu className="size-5" aria-hidden />
            Daha Fazla
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
            <SheetHeader>
              <SheetTitle>Daha Fazla</SheetTitle>
            </SheetHeader>
            <div className="space-y-1 px-4 pb-4">
              {nav.more.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item)}
                  layout="sheet"
                  onNavigate={() => setMoreOpen(false)}
                />
              ))}
              {site && (
                <Link
                  href="/sites"
                  onClick={() => setMoreOpen(false)}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <Building2 className="size-5" aria-hidden />
                  Şantiye Değiştir
                </Link>
              )}
              <SignOutButton />
              <p className="px-3 pt-2 text-xs text-muted-foreground">
                {user.fullName} · {user.role === "admin" ? "Admin" : "Ortak"}
              </p>
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  );
}
