"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { LogoMark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/**
 * The Admin Portal's own header.
 *
 * NAMING — this matters and is easy to get wrong
 * It is called the **Admin Portal**. Not the Government Admin Portal, not the
 * Municipal Admin Portal. It belongs to the CityFlow AI project team today, and
 * could be handed to a public authority later — but naming it after an
 * authority that does not run it would misrepresent who is accountable for it.
 *
 * It is also NOT the Municipal Dashboard. That is the third portal, at
 * /municipal: road inspection, work assignment and repair tracking, with no
 * authority over traffic recommendations and no access to commuter data.
 *
 * The chrome is visibly different from the commuter portal — different mark
 * treatment, no city selector, no assistant — so nobody is ever unsure which
 * side of the product they are looking at.
 */

const ADMIN_LINKS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/demand", label: "Demand" },
  { href: "/admin/roads", label: "Road conditions" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/simulation", label: "Simulation" },
  { href: "/admin/config", label: "Configuration" },
];

export function AdminHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  function isActive(link: (typeof ADMIN_LINKS)[number]): boolean {
    return link.exact ? pathname === link.href : pathname.startsWith(link.href);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border-base bg-surface-2/95 backdrop-blur">
      <Container width="wide">
        <div className="flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/admin" className="inline-flex items-center gap-2.5 rounded-lg">
              <LogoMark className="h-8 w-8" />
              <span className="flex flex-col leading-none">
                <span className="text-[1rem] font-semibold tracking-tight text-fg">
                  Admin Portal
                </span>
                <span className="mt-1 hidden text-[0.65rem] font-medium uppercase tracking-[0.12em] text-subtle sm:block">
                  CityFlow AI
                </span>
              </span>
            </Link>

            <nav aria-label="Admin Portal" className="hidden items-center gap-1 md:flex">
              {ADMIN_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive(link) ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive(link)
                      ? "bg-primary-soft text-primary"
                      : "text-muted hover:bg-surface hover:text-fg"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />

            <Link
              href="/dashboard"
              className="hidden rounded-lg border border-border-base bg-surface px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-fg lg:block"
            >
              Commuter view
            </Link>

            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              loading={signingOut}
              className="hidden sm:inline-flex"
            >
              Sign out
            </Button>

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border-base bg-surface text-fg md:hidden"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                {menuOpen ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>
      </Container>

      {menuOpen && (
        <div className="border-t border-border-base bg-surface md:hidden">
          <Container width="wide">
            <div className="flex flex-col gap-1 py-3">
              {ADMIN_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/dashboard"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2"
              >
                Commuter view
              </Link>
              <Button variant="outline" fullWidth onClick={handleSignOut} loading={signingOut}>
                Sign out
              </Button>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
