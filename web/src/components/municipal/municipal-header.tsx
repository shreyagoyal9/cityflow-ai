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
 * The Municipal Dashboard's own header.
 *
 * WHAT THIS PORTAL IS
 * Road condition management: prioritise → inspect → assign → repair → sign off.
 * It is the third of CityFlow AI's three portals and the most operational of
 * them.
 *
 * WHAT IT IS NOT
 * It has no authority over traffic recommendations, and no access to commuter
 * data of any kind. A municipal officer cannot see a person's routine, their
 * departures, or who reported a pothole. The chrome is deliberately distinct
 * from both the commuter portal and the Admin Portal so nobody is ever unsure
 * which part of the product they are in — and so nobody assumes this screen can
 * see more than it can.
 */

const MUNICIPAL_LINKS = [
  { href: "/municipal", label: "Overview", exact: true },
  { href: "/municipal/issues", label: "Road issues" },
  { href: "/municipal/employees", label: "Workforce" },
];

export function MunicipalHeader() {
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

  function isActive(link: (typeof MUNICIPAL_LINKS)[number]) {
    return link.exact ? pathname === link.href : pathname.startsWith(link.href);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border-base bg-brand-solid">
      <Container width="wide">
        <div className="flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/municipal" className="flex items-center gap-2.5">
              <LogoMark className="h-8 w-8 text-white" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight text-white">
                  Municipal Dashboard
                </span>
                <span className="block text-xs leading-tight text-white/70">
                  Road condition management
                </span>
              </span>
            </Link>

            <nav aria-label="Municipal" className="hidden items-center gap-1 md:flex">
              {MUNICIPAL_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive(link) ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive(link)
                      ? "bg-white/15 text-white"
                      : "text-white/75 hover:bg-white/10 hover:text-white"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              loading={signingOut}
              className="hidden border-white/30 bg-transparent text-white hover:bg-white/10 md:inline-flex"
            >
              Sign out
            </Button>

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="municipal-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/30 text-white md:hidden"
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
        <div id="municipal-menu" className="border-t border-white/15 bg-brand-solid md:hidden">
          <Container width="wide">
            <div className="flex flex-col gap-1 py-3">
              {MUNICIPAL_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10"
                >
                  {link.label}
                </Link>
              ))}
              <Button
                variant="outline"
                fullWidth
                onClick={handleSignOut}
                loading={signingOut}
                className="mt-2 border-white/30 bg-transparent text-white hover:bg-white/10"
              >
                Sign out
              </Button>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
