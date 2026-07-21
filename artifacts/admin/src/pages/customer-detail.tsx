import { useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetCustomer, getGetCustomerQueryKey,
  useGetCustomerWallet, getGetCustomerWalletQueryKey,
  useGetCustomerLoyalty, getGetCustomerLoyaltyQueryKey,
  useUpdateCustomer,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { rechargeWallet, refillSubscription, adjustLoyaltyPoints } from "@/lib/customers-api";
import { ArrowLeft, Wallet, Star, Pencil, PlusCircle, CalendarPlus } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

function StatusBadge({ status }: { status: string }) {
  const color = status === "ACTIVE" ? "bg-green-500/10 text-green-700" : status === "SUSPENDED" ? "bg-yellow-500/10 text-yellow-700" : status === "EXPIRED" ? "bg-red-500/10 text-red-700" : "bg-gray-100 text-gray-500";
  return <span className={`inline-flex px-2 py-0.5 rounded-sm text-xs font-medium ${color}`}>{status}</span>;
}

export default function CustomerDetailPage() {
  const [, params] = useRoute("/customers/:id");
  const id = params?.id ?? "";
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: customer, isLoading } = useGetCustomer(id, { query: { enabled: !!id, queryKey: getGetCustomerQueryKey(id) } });
  const { data: wallet } = useGetCustomerWallet(id, { query: { enabled: !!id, queryKey: getGetCustomerWalletQueryKey(id) } });
  const { data: loyalty } = useGetCustomerLoyalty(id, { query: { enabled: !!id, queryKey: getGetCustomerLoyaltyQueryKey(id) } });
  const toggleActive = useUpdateCustomer();

  function handleToggleActive() {
    if (!customer) return;
    toggleActive.mutate({ id, data: { isActive: !customer.isActive } }, {
      onSuccess: () => {
        toast({ title: `Client ${customer.isActive ? "deactivated" : "activated"}` });
        qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
      },
    });
  }

  function editProfile() {
    if (!customer) return;
    const phone = prompt("Client phone number", customer.phone);
    if (phone === null || !phone.trim()) return;
    const email = prompt("Client email", customer.email ?? "");
    const address = prompt("Client address", customer.address ?? "");
    toggleActive.mutate({ id, data: { phone: phone.trim(), email: email?.trim() || null, address: address?.trim() || null } }, {
      onSuccess: () => { toast({ title: "Client profile updated" }); qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) }); },
      onError: () => toast({ title: "Could not update client profile", variant: "destructive" }),
    });
  }

  const recharge = useMutation({
    mutationFn: (data: { amount: number; reference?: string }) => rechargeWallet(id, data),
    onSuccess: (result) => {
      toast({ title: result.message });
      qc.invalidateQueries({ queryKey: getGetCustomerWalletQueryKey(id) });
    },
    onError: (err: any) => toast({ title: err?.data?.error ?? "Could not recharge wallet", variant: "destructive" }),
  });

  function handleRecharge() {
    const raw = prompt("Amount to credit (KES)");
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) { toast({ title: "Enter an amount greater than zero", variant: "destructive" }); return; }
    const reference = prompt("Reference (optional — e.g. receipt or till number)") ?? undefined;
    recharge.mutate({ amount, reference: reference?.trim() || undefined });
  }

  const loyaltyAdjust = useMutation({
    mutationFn: (data: { points: number; reason?: string }) => adjustLoyaltyPoints(id, data),
    onSuccess: (result) => {
      toast({ title: result.message });
      qc.invalidateQueries({ queryKey: getGetCustomerLoyaltyQueryKey(id) });
    },
    onError: (err: any) => toast({ title: err?.data?.error ?? "Could not adjust Loyalty Points", variant: "destructive" }),
  });

  function handleLoyaltyAdjust() {
    const raw = prompt("Points to add (use a negative number to deduct, e.g. -50)");
    if (raw === null) return;
    const points = Number(raw);
    if (!Number.isInteger(points) || points === 0) { toast({ title: "Enter a non-zero whole number", variant: "destructive" }); return; }
    const reason = prompt("Reason (optional)") ?? undefined;
    loyaltyAdjust.mutate({ points, reason: reason?.trim() || undefined });
  }

  const refill = useMutation({
    mutationFn: (data: { days: number }) => refillSubscription(id, data),
    onSuccess: (result) => {
      toast({ title: result.message });
      qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
    },
    onError: (err: any) => toast({ title: err?.data?.error ?? "Could not refill service", variant: "destructive" }),
  });

  function handleRefill() {
    const raw = prompt("Extend active subscription by how many days?");
    if (raw === null) return;
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 365) { toast({ title: "Enter a whole number of days from 1 to 365", variant: "destructive" }); return; }
    refill.mutate({ days });
  }

  if (isLoading) return <AppLayout><div className="p-6 text-sm text-muted-foreground">Loading...</div></AppLayout>;
  if (!customer) return <AppLayout><div className="p-6 text-sm">Client not found</div></AppLayout>;

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/customers"><a className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /></a></Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold">{customer.firstName} {customer.lastName}</h1>
            <p className="text-xs text-muted-foreground">{customer.phone} {customer.email && `• ${customer.email}`}</p>
          </div>
          <Button size="sm" variant={customer.isActive ? "outline" : "default"} onClick={handleToggleActive} disabled={toggleActive.isPending} data-testid="btn-toggle-active">
            {customer.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button size="sm" variant="outline" onClick={editProfile} disabled={toggleActive.isPending}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit Profile</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-md p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Details</p>
            {[
              ["Status", <span className={`text-xs font-medium ${customer.isActive ? "text-green-600" : "text-gray-400"}`}>{customer.isActive ? "Active" : "Inactive"}</span>],
              ["National ID", customer.nationalId ?? "—"],
              ["Address", customer.address ?? "—"],
              ["Joined", new Date(customer.createdAt).toLocaleDateString()],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-right">{v}</span>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Subscription</p>
              {(customer as any).activeSubscription && (
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleRefill} disabled={refill.isPending} data-testid="btn-refill-subscription">
                  <CalendarPlus className="w-3.5 h-3.5 mr-1" /> Refill
                </Button>
              )}
            </div>
            {(customer as any).activeSubscription ? (
              <>
                {[
                  ["Plan", (customer as any).activeSubscription.planName ?? "—"],
                  ["Status", <StatusBadge status={(customer as any).activeSubscription.status} />],
                  ["Expires", new Date((customer as any).activeSubscription.expiresAt).toLocaleDateString()],
                  ["Auto-Renew", (customer as any).activeSubscription.autoRenew ? "Yes" : "No"],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium text-right">{v}</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No active subscription</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold">Wallet</p>
              <span className="ml-auto text-sm font-bold">KES {Number(wallet?.balance ?? 0).toLocaleString()}</span>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleRecharge} disabled={recharge.isPending} data-testid="btn-recharge-wallet">
                <PlusCircle className="w-3.5 h-3.5 mr-1" /> Recharge
              </Button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {(wallet?.transactions ?? []).slice(0, 10).map(t => (
                <div key={t.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground truncate">{t.description}</span>
                  <span className={`font-medium ml-2 shrink-0 ${t.amount > 0 ? "text-green-600" : "text-red-500"}`}>
                    {t.amount > 0 ? "+" : ""}KES {Math.abs(t.amount).toLocaleString()}
                  </span>
                </div>
              ))}
              {!wallet?.transactions?.length && <p className="text-xs text-muted-foreground">No transactions</p>}
            </div>
          </div>

          <div className="bg-card border border-border rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-yellow-500" />
              <p className="text-sm font-semibold">Loyalty Points</p>
              <span className="ml-auto text-sm font-bold">{(loyalty?.balance ?? 0).toLocaleString()} pts</span>
            </div>
            <p className="text-xs text-muted-foreground">Lifetime earned: {(loyalty?.lifetimeEarned ?? 0).toLocaleString()} pts</p>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs mt-2" onClick={handleLoyaltyAdjust} disabled={loyaltyAdjust.isPending} data-testid="btn-adjust-loyalty">
              <PlusCircle className="w-3.5 h-3.5 mr-1" /> Adjust
            </Button>
            <div className="space-y-1.5 mt-3 max-h-32 overflow-y-auto">
              {(loyalty?.transactions ?? []).slice(0, 8).map((t: any) => (
                <div key={t.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground truncate">{t.description}</span>
                  <span className={`font-medium ml-2 shrink-0 ${t.points > 0 ? "text-green-600" : "text-red-500"}`}>
                    {t.points > 0 ? "+" : ""}{t.points} pts
                  </span>
                </div>
              ))}
              {!loyalty?.transactions?.length && <p className="text-xs text-muted-foreground">No transactions</p>}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
