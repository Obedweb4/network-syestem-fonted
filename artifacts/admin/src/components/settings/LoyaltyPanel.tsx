import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Wallet as WalletIcon, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { getLoyaltyOverview, getTenant, updateTenant } from "@/lib/settings-api";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function LoyaltyRateConfig({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const tenant = useQuery({ queryKey: ["settings", "tenant"], queryFn: getTenant });
  const [earnRate, setEarnRate] = useState("0");
  const [redemptionValue, setRedemptionValue] = useState("1");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant.data) return;
    setEarnRate(tenant.data.tenant.loyaltyPointsPerKes);
    setRedemptionValue(tenant.data.tenant.loyaltyRedemptionValueKes);
  }, [tenant.data]);

  async function save() {
    const rate = Number(earnRate);
    const value = Number(redemptionValue);
    if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(value) || value < 0) {
      toast({ title: "Enter valid non-negative numbers", variant: "destructive" });
      return;
    }
    setSaving(true);
    const result = await updateTenant({ loyaltyPointsPerKes: rate, loyaltyRedemptionValueKes: value })
      .catch((err) => { toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }); return null; });
    setSaving(false);
    if (result) { toast({ title: "Loyalty Points settings saved" }); qc.invalidateQueries({ queryKey: ["settings", "tenant"] }); }
  }

  const currentRate = Number(tenant.data?.tenant.loyaltyPointsPerKes ?? "0");

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Earn rate</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {currentRate > 0
            ? `Customers currently earn ${currentRate} point(s) per KES 1 paid, awarded automatically on every successful subscription payment (M-PESA or voucher).`
            : "Earning is currently off (rate is 0) — customers' balances only change via manual admin adjustment on their customer page. Set a rate below to start awarding points automatically."}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Points earned per KES 1 paid</Label>
            <Input type="number" min={0} step="0.01" value={earnRate} onChange={(e) => setEarnRate(e.target.value)} disabled={!isAdmin} data-testid="input-loyalty-earn-rate" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">KES value per point redeemed</Label>
            <Input type="number" min={0} step="0.01" value={redemptionValue} onChange={(e) => setRedemptionValue(e.target.value)} disabled={!isAdmin} data-testid="input-loyalty-redemption-value" />
          </div>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </Button>
        )}
        <p className="text-xs text-muted-foreground pt-1 border-t border-border">
          Need to credit or correct an individual customer's points (a bonus, a goodwill gesture, fixing a mistake)? Use <strong>Adjust</strong> on their customer page, not this rate — this only controls automatic earning going forward.
        </p>
      </CardContent>
    </Card>
  );
}

export function LoyaltyPanel({ focus, isAdmin }: { focus: "loyalty" | "wallet"; isAdmin: boolean }) {
  const overview = useQuery({ queryKey: ["settings", "loyalty-overview"], queryFn: getLoyaltyOverview });
  const data = overview.data;

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h2 className="text-base font-semibold flex items-center gap-2">
          {focus === "loyalty" ? <Star className="w-4 h-4" /> : <WalletIcon className="w-4 h-4" />}
          {focus === "loyalty" ? "Loyalty Points" : "Wallet"}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {focus === "loyalty" ? "Loyalty points customers earn and redeem." : "Prepaid balances customers hold with you."}
        </p>
      </div>

      {focus === "loyalty" ? (
        <>
          <Card>
            <CardHeader><CardTitle className="text-sm">Tenant-wide totals</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <Stat label="Accounts with a balance" value={data?.loyalty.accountsWithBalance ?? "—"} />
              <Stat label="Outstanding points" value={data?.loyalty.outstandingPoints ?? "—"} />
              <Stat label="Lifetime earned" value={data?.loyalty.lifetimeEarned ?? "—"} />
            </CardContent>
          </Card>
          <LoyaltyRateConfig isAdmin={isAdmin} />
        </>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-sm">Tenant-wide totals</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Stat label="Wallet accounts" value={data?.wallet.accounts ?? "—"} />
              <Stat label="Outstanding balance" value={data ? `KES ${data.wallet.outstandingBalanceKes.toLocaleString()}` : "—"} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">
                Wallets are credited manually today — <strong>Recharge</strong> on a customer's page (e.g. for a cash top-up). There's no "pay with wallet balance" purchase flow yet (packages are still only paid for via M-PESA or vouchers) and no tenant-level configuration here (no cashback rate, no auto-top-up) — it's a straight KES ledger, view-and-recharge only.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
