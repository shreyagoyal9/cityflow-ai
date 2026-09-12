"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { AdminHeader } from "@/components/admin/admin-header";
import { MunicipalHeader } from "@/components/municipal/municipal-header";
import type { SessionRole } from "@/lib/auth/jwt";
import { Logo } from "@/components/brand/logo";
import { SaarthiMark } from "@/components/brand/saarthi-mark";
import { ASSISTANT_NAME } from "@/lib/chat/branding";
import { CitySelector } from "@/components/city/city-selector";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button, ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/**
 * Site header.
 *
 * Contains, from left to right:
 *   logo → navigation → city selector → notifications → theme toggle → account
 *
 * On small screens the navigation collapses into a single menu button so the
 * city selector and the theme toggle always stay reachable with one thumb.
 */

/** Minimal view of the signed-in user that the header needs. */
export interface HeaderSession {
  cityflowId: string;
  role: SessionRole;
}

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How it works" },
];

/**
 * Commuter links, shown once signed in.
 *
 * Order is deliberate and follows how often each is used: the dashboard every
 * day, journeys when something changes, a one-off trip occasionally, rewards
 * now and then. Roads and the assistant follow in the mobile menu.
 */
const SIGNED_IN_LINKS = [
  { href: "/dashboard", label: "My dashboard" },
  { href: "/journeys", label: "Journeys" },
  { href: "/plan", label: "Plan a trip" },
  { href: "/insights", label: "Insights" },
  { href: "/rewards", label: "Rewards" },
  { href: "/roads", label: "Roads" },
];

export function SiteHeader({ session }: { session: HeaderSession | null }) {
  const pathname = usePathname();
  const router = useRouter();

  /*
    ⚠️ HOOKS MUST COME BEFORE THE EARLY RETURN BELOW.
    React requires every render of a component to call the same hooks in the
    same order. An earlier version returned <AdminHeader /> above these two
    useState calls, which meant navigating from /dashboard to /admin rendered
    fewer hooks than the previous render and crashed the app with "Rendered
    fewer hooks than expected". Declaring state first costs nothing and makes
    that class of bug impossible here.
  */
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  /*
    The Admin Portal has its own chrome. Swapping it in here — rather than
    restructuring the app into route groups — keeps one header component
    responsible for "what does the top of the page look like", and guarantees
    the commuter navigation can never appear on an admin screen.
  */
  if (pathname.startsWith("/admin")) return <AdminHeader />;
  if (pathname.startsWith("/municipal")) return <MunicipalHeader />;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // refresh() re-runs the server components so the header updates instantly.
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border-base bg-surface/90 backdrop-blur">
      <Container width="wide">
        <div className="flex h-16 items-center justify-between gap-3">
          {/* -------------------------------------------------- left: brand */}
          <div className="flex min-w-0 items-center gap-6 lg:gap-8">
            <Logo />

            <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
              {NAV_LINKS.map((link) => {
                const isActive =
                  link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary-soft text-primary"
                        : "text-muted hover:bg-surface-2 hover:text-fg"
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}

              {/*
                The signed-in links are data-driven rather than six near-identical
                blocks. Adding a portal to the product should be one line here, not
                a copy-paste that quietly drifts out of sync with the mobile menu.
              */}
              {session &&
                SIGNED_IN_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={pathname.startsWith(link.href) ? "page" : undefined}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      pathname.startsWith(link.href)
                        ? "bg-primary-soft text-primary"
                        : "text-muted hover:bg-surface-2 hover:text-fg"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}

              {/*
                Admins reach the portal from here. It is deliberately the last
                item and visually identical to the rest — the Admin Portal is a
                different part of the product, not a status symbol.
              */}
              {session?.role === "ADMIN" && (
                <Link
                  href="/admin"
                  aria-current={pathname.startsWith("/admin") ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    pathname.startsWith("/admin")
                      ? "bg-primary-soft text-primary"
                      : "text-muted hover:bg-surface-2 hover:text-fg"
                  )}
                >
                  Admin Portal
                </Link>
              )}

              {(session?.role === "MUNICIPAL" || session?.role === "ADMIN") && (
                <Link
                  href="/municipal"
                  aria-current={pathname.startsWith("/municipal") ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    pathname.startsWith("/municipal")
                      ? "bg-primary-soft text-primary"
                      : "text-muted hover:bg-surface-2 hover:text-fg"
                  )}
                >
                  Municipal
                </Link>
              )}

              {session && (
                <Link
                  href="/assistant"
                  aria-current={pathname.startsWith("/assistant") ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    pathname.startsWith("/assistant")
                      ? "bg-primary-soft text-primary"
                      : "text-muted hover:bg-surface-2 hover:text-fg"
                  )}
                >
                  <SaarthiMark className="h-4 w-4" />
                  {ASSISTANT_NAME}
                </Link>
              )}
            </nav>
          </div>

          {/* ------------------------------------------------- right: tools */}
          <div className="flex shrink-0 items-center gap-2">
            <CitySelector className="hidden md:block" />

            <NotificationsButton />
            <ThemeToggle />

            {session ? (
              <div className="hidden items-center gap-2 lg:flex">
                <span
                  className="rounded-lg border border-border-base bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-muted"
                  title="Your anonymous CityFlow ID"
                >
                  {session.cityflowId}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  loading={signingOut}
                >
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="hidden items-center gap-2 lg:flex">
                <ButtonLink href="/login" variant="ghost" size="sm">
                  Log in
                </ButtonLink>
                <ButtonLink href="/signup" size="sm">
                  Get started
                </ButtonLink>
              </div>
            )}

            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border-base bg-surface text-fg lg:hidden"
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
                {mobileMenuOpen ? (
                  <path d="M18 6 6 18M6 6l12 12" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </Container>

      {/* ---------------------------------------------------- mobile drawer */}
      {mobileMenuOpen && (
        <div id="mobile-menu" className="border-t border-border-base bg-surface lg:hidden">
          <Container width="wide">
            <div className="flex flex-col gap-2 py-4">
              <div className="md:hidden">
                <CitySelector variant="full" className="w-full" />
              </div>

              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
                >
                  {link.label}
                </Link>
              ))}

              {session ? (
                <>
                  {SIGNED_IN_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
                    >
                      {link.label}
                    </Link>
                  ))}
                  <Link
                    href="/assistant"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
                  >
                    <SaarthiMark className="h-4 w-4 text-primary" />
                    {ASSISTANT_NAME} · your travel guide
                  </Link>
                  <Link
                    href="/participation"
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
                  >
                    My participation
                  </Link>
                  <Link
                    href="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
                  >
                    My profile
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
                  >
                    Settings
                  </Link>
                  {session.role === "ADMIN" && (
                    <Link
                      href="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
                    >
                      Admin Portal
                    </Link>
                  )}
                  {(session.role === "MUNICIPAL" || session.role === "ADMIN") && (
                    <Link
                      href="/municipal"
                      onClick={() => setMobileMenuOpen(false)}
                      className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
                    >
                      Municipal Dashboard
                    </Link>
                  )}
                  <p className="px-3 py-1 text-xs text-subtle">
                    CityFlow ID:{" "}
                    <span className="font-mono text-muted">{session.cityflowId}</span>
                  </p>
                  <Button variant="outline" fullWidth onClick={handleSignOut} loading={signingOut}>
                    Sign out
                  </Button>
                </>
              ) : (
                <div className="mt-1 flex flex-col gap-2">
                  <ButtonLink href="/login" variant="outline" fullWidth>
                    Log in
                  </ButtonLink>
                  <ButtonLink href="/signup" fullWidth>
                    Get started
                  </ButtonLink>
                </div>
              )}
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}

/**
 * Notifications.
 *
 * Phase 1 has nothing to notify about yet, so this deliberately shows an honest
 * empty state instead of fake alerts. Real notifications arrive in Phase 3, when
 * recommendations can change during the day.
 */
function NotificationsButton() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-expanded={open}
        aria-label="Notifications"
        className="hidden h-10 w-10 items-center justify-center rounded-lg border border-border-base bg-surface text-fg transition-colors hover:bg-surface-2 md:inline-flex"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-card border border-border-base bg-surface p-4 shadow-float">
          <p className="text-sm font-semibold text-fg">Notifications</p>
          <p className="mt-2 text-sm text-muted">
            You have no notifications yet. Once your travel routine is set up, CityFlow AI
            will let you know when your recommended departure time changes.
          </p>
        </div>
      )}
    </div>
  );
}
