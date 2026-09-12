"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/input";

/**
 * The rewards marketplace.
 *
 * The honesty notice at the top is not decoration and must not be removed: no
 * partner is connected to this system, and a person spending points they earned
 * deserves to know that before they spend them, not after.
 */

export interface CatalogueItem {
  id: string;
  title: string;
  description: string;
  category: string;
  pointsCost: number;
  partnerName: string | null;
  stock: number | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  PARKING: "Parking",
  FUEL: "Fuel",
  TRANSIT: "Transit",
  FOOD: "Food & drink",
  SHOPPING: "Shopping",
  CIVIC: "Civic",
  OTHER: "Other",
};

export function RewardCatalogue({
  items,
  balance,
}: {
  items: CatalogueItem[];
  balance: number;
}) {
  const router = useRouter();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<{ code: string; title: string } | null>(null);

  async function handleRedeem(item: CatalogueItem) {
    setBusyId(item.id);
    setError(null);
    setVoucher(null);

    try {
      const response = await fetch("/api/rewards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "We could not complete this redemption.");
        return;
      }

      setVoucher({ code: data.voucherCode, title: item.title });
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Notice tone="info">
        <span className="font-medium">These are sample rewards.</span> CityFlow AI has no
        payment or partner integration — redeeming produces a reference code and records the
        points you spent. No business is notified and no discount is guaranteed. The ledger
        behind it is real; the partnerships are not.
      </Notice>

      {error && <Notice tone="error">{error}</Notice>}

      {voucher && (
        <Notice tone="success">
          <span className="font-medium">{voucher.title} redeemed.</span> Your reference is{" "}
          <span className="font-mono font-semibold">{voucher.code}</span>. It is saved in
          your redemption history below.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => {
          const affordable = balance >= item.pointsCost;
          const soldOut = item.stock !== null && item.stock <= 0;

          return (
            <Card key={item.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <Badge tone="secondary">
                  {CATEGORY_LABEL[item.category] ?? item.category}
                </Badge>
                <span className="shrink-0 text-sm font-semibold text-fg">
                  {item.pointsCost} pts
                </span>
              </div>

              <h3 className="mt-3 text-base font-semibold text-fg">{item.title}</h3>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">
                {item.description}
              </p>

              {item.partnerName && (
                <p className="mt-2 text-xs text-subtle">Offered by {item.partnerName}</p>
              )}

              <div className="mt-4">
                <Button
                  fullWidth
                  variant={affordable && !soldOut ? "primary" : "outline"}
                  disabled={!affordable || soldOut}
                  loading={busyId === item.id}
                  onClick={() => handleRedeem(item)}
                >
                  {soldOut
                    ? "Out of stock"
                    : affordable
                      ? "Redeem"
                      : `${item.pointsCost - balance} more points needed`}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
