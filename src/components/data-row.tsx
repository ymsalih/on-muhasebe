import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type DataRowProps = {
  /** Verilirse satır bir bağlantı olur. */
  href?: string;
  /** Verilirse satır bir düğme olur (ör. düzenleme penceresi açmak için). */
  onClick?: () => void;
  title: React.ReactNode;
  /** Başlığın yanında küçük rozet (belge türü, durum vb.). */
  badge?: React.ReactNode;
  /** Başlığın altındaki ikincil satırlar. */
  lines?: React.ReactNode[];
  /** Sağ taraf: tutar, tarih vb. */
  trailing?: React.ReactNode;
  className?: string;
};

/**
 * Tüm listelerin ortak satır bileşeni (CLAUDE.md 7.4): irsaliye, cari, personel ve kasa hareketleri
 * görsel olarak birbirinin varyasyonu olsun diye aynı yapıyı paylaşır. Bir `divide-y` kartı içinde kullanılır.
 */
export function DataRow({ href, onClick, title, badge, lines, trailing, className }: DataRowProps) {
  const interactive = !!href || !!onClick;
  const content = (
    <>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {badge}
        </div>
        {lines?.filter(Boolean).map((line, i) => (
          <p key={i} className="truncate text-xs text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
      {trailing && <div className="shrink-0 text-right text-sm">{trailing}</div>}
      {interactive && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );

  const base = "flex min-h-16 items-center gap-3 px-4 py-3";
  if (href) {
    return (
      <Link href={href} className={cn(base, "hover:bg-muted/50", className)}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, "w-full text-left hover:bg-muted/50", className)}>
        {content}
      </button>
    );
  }
  return <div className={cn(base, className)}>{content}</div>;
}
