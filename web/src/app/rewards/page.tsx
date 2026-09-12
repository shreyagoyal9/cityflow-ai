import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RewardCatalogue } from "@/components/rewards/reward-catalogue";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { appLocalDate } from "@/lib/app-time";
import { getCurrentUser } from "@/lib/auth/session";
import { getCity } from "@/lib/cities";
import { getCityConfig } from "@/lib/city-config";
import {
  listCatalogue,
  listRedemptions,
  listTransactions,
} from "@/lib/rewards/catalogue";
import {
  REWARD_KIND_LABEL,
  ensureRewards,
  leaderboard,
  pointsEarnedToday,
} from "@/lib/rewards/ledger";

export const metadata: Metadata = {
  title: "Rewards",
};

/**
 * Rewards.
 *
 * WHY THIS PAGE EXISTS AT ALL
 * Demand smoothing asks people to do something mildly inconvenient for a
 * benefit that is mostly collective. Points are the acknowledgement that the
 * inconvenience is real — the person moved their morning, and somebody noticed.
 *
 * The page is built to be honest about its own limits: the ledger is real, the
 * partnerships are not, and it says so above the catalogue rather than in a
 * footnote.
 */
export default async function RewardsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/rewards");

  const city = getCity(user.cityCode);

  const startOfDay = appLocalDate();
  startOfDay.setHours(0, 0, 0, 0);

  const [rewards, catalogue, transactions, redemptions, today, config, ranking] =
    await Promise.all([
      ensureRewards(user.id),
      listCatalogue(city.code),
      listTransactions(user.id),
      listRedemptions(user.id),
      pointsEarnedToday(user.id, startOfDay),
      getCityConfig(city.code),
      leaderboard(city.code),
    ]);

  return (
    <section className="py-8 sm:py-12">
      <Container width="wide">
        <SectionHeading
          eyebrow="Your contribution"
          title="Rewards"
          description="Points recognise the trips where you helped flatten the city's peak."
        />

        {/* ---------------------------------------------------------- totals */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <BalanceTile caption="Available to spend" value={rewards.pointsBalance} accent />
          <BalanceTile caption="Earned today" value={today} />
          <BalanceTile caption="Earned all time" value={rewards.lifetimePoints} />
        </div>

        {/* ------------------------------------------------------ how to earn */}
        <div className="mt-6">
          <Card>
            <CardHeader
              title="How points are earned"
              description={`Set by ${city.name} — a city can change any of these.`}
            />
            <ul className="grid gap-3 sm:grid-cols-2">
              <EarnRow
                points={config.pointsForFollowingRecommendation}
                label="Follow a departure recommendation"
                detail="Credited when you accept a suggested time. Keeping your usual time is never penalised — it simply earns nothing."
              />
              <EarnRow
                points={config.pointsForCarpool}
                label="Share a vehicle"
                detail="One car instead of two takes a whole vehicle off the road at the busiest moment."
              />
              <EarnRow
                points={config.pointsForModeSwitch}
                label="Switch to transit, cycling or walking"
                detail="The largest single contribution a person can make, and paid accordingly."
              />
              <EarnRow
                points={config.pointsForCorroboratedRoadReport}
                label="Report a road issue others confirm"
                detail="Credited only once independent reports agree, so the incentive is accuracy rather than volume."
              />
            </ul>
          </Card>
        </div>

        {/* ------------------------------------------------------- catalogue */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-fg">Spend your points</h2>
          <div className="mt-4">
            <RewardCatalogue
              balance={rewards.pointsBalance}
              items={catalogue.map((item) => ({
                id: item.id,
                title: item.title,
                description: item.description,
                category: item.category,
                pointsCost: item.pointsCost,
                partnerName: item.partnerName,
                stock: item.stock,
              }))}
            />
          </div>
        </div>

        {/* -------------------------------------------- history + leaderboard */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Points history"
              description="Every entry, newest first. Nothing here is ever edited or removed."
            />

            {transactions.length === 0 ? (
              <p className="text-sm text-muted">
                No points yet. Accept a departure recommendation on your dashboard and the
                first entry will appear here.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {transactions.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start justify-between gap-4 border-b border-border-base pb-2.5 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-fg">{entry.description}</p>
                      <p className="mt-0.5 text-xs text-subtle">
                        {REWARD_KIND_LABEL[entry.kind]}
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        {entry.createdAt.toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                    </div>
                    <span
                      className={
                        entry.points >= 0
                          ? "shrink-0 text-sm font-semibold text-traffic-low"
                          : "shrink-0 text-sm font-semibold text-muted"
                      }
                    >
                      {entry.points >= 0 ? "+" : ""}
                      {entry.points}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Your vouchers"
                description="Reference codes from rewards you have redeemed."
              />

              {redemptions.length === 0 ? (
                <p className="text-sm text-muted">
                  You have not redeemed anything yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {redemptions.map((redemption) => (
                    <li
                      key={redemption.id}
                      className="rounded-lg border border-border-base bg-surface-2 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-fg">
                          {redemption.item.title}
                        </p>
                        <span className="shrink-0 text-xs text-muted">
                          −{redemption.pointsSpent} pts
                        </span>
                      </div>
                      <p className="mt-1.5 font-mono text-sm font-semibold text-primary">
                        {redemption.voucherCode}
                      </p>
                      <p className="mt-1 text-xs text-subtle">
                        Valid until{" "}
                        {redemption.expiresAt.toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title={`Top contributors in ${city.name}`}
                description="Ranked by points earned all time."
              />

              {ranking.length === 0 ? (
                <p className="text-sm text-muted">
                  Nobody has earned points in {city.name} yet.
                </p>
              ) : (
                <ol className="space-y-2">
                  {ranking.map((row) => {
                    const isYou = row.cityflowId === user.cityflowId;
                    return (
                      <li
                        key={row.cityflowId}
                        className={
                          isYou
                            ? "flex items-center justify-between gap-3 rounded-lg bg-primary-soft px-3 py-2"
                            : "flex items-center justify-between gap-3 px-3 py-2"
                        }
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="w-5 shrink-0 text-sm font-semibold text-muted">
                            {row.rank}
                          </span>
                          <span className="truncate font-mono text-sm text-fg">
                            {row.cityflowId}
                          </span>
                          {isYou && <Badge tone="primary">You</Badge>}
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-fg">
                          {row.lifetimePoints}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}

              <p className="mt-4 text-xs leading-relaxed text-subtle">
                The leaderboard shows anonymous CityFlow IDs, never names or email
                addresses. You can recognise your own row because you know your own ID;
                nobody can identify anybody else. Only people who chose to share
                aggregated data appear here.
              </p>
            </Card>
          </div>
        </div>
      </Container>
    </section>
  );
}

function BalanceTile({
  caption,
  value,
  accent = false,
}: {
  caption: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-card border-2 border-primary bg-primary-soft p-5"
          : "rounded-card border border-border-base bg-surface p-5 shadow-card"
      }
    >
      <p className="text-xs font-medium uppercase tracking-wider text-subtle">{caption}</p>
      <p
        className={
          accent
            ? "mt-1 text-3xl font-semibold tracking-tight text-primary"
            : "mt-1 text-3xl font-semibold tracking-tight text-fg"
        }
      >
        {value.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

function EarnRow({
  points,
  label,
  detail,
}: {
  points: number;
  label: string;
  detail: string;
}) {
  return (
    <li className="flex gap-3 rounded-lg border border-border-base bg-surface-2 p-3">
      <span className="shrink-0 rounded-md bg-secondary-soft px-2 py-1 text-sm font-semibold text-secondary">
        +{points}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{detail}</span>
      </span>
    </li>
  );
}
