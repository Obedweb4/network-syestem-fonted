import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListSubscriptions, getListSubscriptionsQueryKey, useCreateSubscription,
  useUpdateSubscription, useListCustomers, useListPlans,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Plus, Settings2, KeyRound, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  fetchProvisioningStatus, reprovisionSubscription, resetSubscriberPassword, errorMessage,
} from "@/lib/provisioning-api";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-500/10 text-green-700",
  SUSPENDED: "bg-yellow-500/10 text-yellow-700",
  EXPIRED: "bg-red-500/10 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-500",
};

const schema = z.object({
  customerId: z.string().uuid("Select a customer"),
  planId: z.string().uuid("Select a plan"),
  startsAt: z.string().min(1, "Required"),
  autoRenew: z.boolean().optional(),
});

type SubForm = z.infer<typeof schema>;

export default function SubscriptionsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const params = { page, limit, ...(statusFilter ? { status: statusFilter as any } : {}) };
  const { data, isLoading } = useListSubscriptions(params, { query: { queryKey: getListSubscriptionsQueryKey(params) } });
  const { data: customers } = useListCustomers({ limit: 200 }, { query: { queryKey: ["customers-select"] as any } });
  const { data: plans } = useListPlans({}, { query: { queryKey: ["plans-select"] as any } });
  const createMut = useCreateSubscription();
  const updateMut = useUpdateSubscription();

  const form = useForm<SubForm>({ resolver: zodResolver(schema), defaultValues: { customerId: "", planId: "", startsAt: new Date().toISOString().slice(0, 10) } });

  function onSubmit(values: SubForm) {
    createMut.mutate({ data: { ...values, startsAt: values.startsAt } }, {
      onSuccess: () => { toast({ title: "Subscription created" }); qc.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() }); setOpen(false); form.reset(); },
      onError: () => toast({ title: "Failed to create subscription", variant: "destructive" }),
    });
  }

  function handleStatus(id: string, status: string) {
    updateMut.mutate({ id, data: { status: status as any } }, {
      onSuccess: () => { toast({ title: "Status updated" }); qc.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() }); },
    });
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-4 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Subscriptions</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{data?.total ?? 0} total</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All statuses</SelectItem>
                {["ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setOpen(true)} data-testid="btn-add-subscription"><Plus className="w-3.5 h-3.5 mr-1" /> New</Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Client", "Plan", "Status", "Starts", "Expires", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground">Loading...</td></tr>}
              {!isLoading && !data?.data?.length && <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground">No subscriptions found</td></tr>}
              {data?.data?.map(s => (
                <tr key={s.id} data-testid={`row-subscription-${s.id}`}>
                  <td className="px-4 py-2.5 text-xs font-medium">{s.customerName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{s.planName ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-1.5 py-0.5 rounded-sm text-xs font-medium ${STATUS_COLORS[s.status] ?? ""}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(s.startsAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(s.expiresAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Select value={s.status} onValueChange={v => handleStatus(s.id, v)}>
                        <SelectTrigger className="h-6 text-xs w-28" data-testid={`select-status-${s.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"].map(st => <SelectItem key={st} value={st} className="text-xs">{st}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Manage network access" onClick={() => setManageId(s.id)} data-testid={`btn-manage-${s.id}`}>
                        <Settings2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.total > limit && (
            <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(data.total / limit)}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button size="sm" variant="outline" disabled={page * limit >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Subscription</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField control={form.control} name="customerId" render={({ field }) => (
                <FormItem><FormLabel>Client</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger data-testid="select-customer"><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {customers?.data?.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.firstName} {c.lastName} — {c.phone}</SelectItem>)}
                    </SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="planId" render={({ field }) => (
                <FormItem><FormLabel>Plan</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger data-testid="select-plan"><SelectValue placeholder="Select plan" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {(plans as any)?.map((p: any) => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name} — KES {Number(p.price).toLocaleString()}</SelectItem>)}
                    </SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="startsAt" render={({ field }) => (
                <FormItem><FormLabel>Starts At</FormLabel><FormControl><Input {...field} type="date" data-testid="input-starts-at" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending} data-testid="btn-submit-subscription">Create</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <Dialog open={manageId !== null} onOpenChange={(v) => !v && setManageId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Network Access</DialogTitle></DialogHeader>
          {manageId && <ProvisioningPanel subscriptionId={manageId} plans={(plans as any) ?? []} onClose={() => setManageId(null)} />}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

const PROV_STATUS_COLORS: Record<string, string> = {
  SUCCESS: "bg-green-500/10 text-green-700",
  FAILED: "bg-red-500/10 text-red-700",
  PENDING: "bg-yellow-500/10 text-yellow-700",
  IN_PROGRESS: "bg-yellow-500/10 text-yellow-700",
  SUSPENDED: "bg-gray-200 text-gray-600",
  DEPROVISIONED: "bg-gray-100 text-gray-400",
};

/** Live provisioning status + actions for one subscription — its own component so its data fetch only runs while the dialog is open. */
function ProvisioningPanel({ subscriptionId, plans, onClose }: { subscriptionId: string; plans: any[]; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newPlanId, setNewPlanId] = useState("");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["provisioning", subscriptionId],
    queryFn: () => fetchProvisioningStatus(subscriptionId),
  });

  function refreshEverything() {
    refetch();
    qc.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
  }

  function handleResetPassword() {
    resetSubscriberPassword(subscriptionId)
      .then((res) => {
        if (res.success && res.password) {
          toast({ title: "Password reset", description: `New router password: ${res.password} — copy this now, it won't be shown again.` });
        } else {
          toast({ title: "Reset failed", description: res.error, variant: "destructive" });
        }
        refreshEverything();
      })
      .catch((err) => toast({ title: "Reset failed", description: errorMessage(err, "Could not reset password"), variant: "destructive" }));
  }

  function handleReprovision() {
    if (!newPlanId) { toast({ title: "Select a plan first", variant: "destructive" }); return; }
    reprovisionSubscription(subscriptionId, { newPlanId })
      .then((res) => {
        toast({ title: res.success ? "Plan changed" : "Reprovision failed", description: res.error, variant: res.success ? undefined : "destructive" });
        refreshEverything();
      })
      .catch((err) => toast({ title: "Reprovision failed", description: errorMessage(err, "Could not change plan"), variant: "destructive" }));
  }

  if (isLoading) return <p className="text-xs text-muted-foreground py-4">Loading...</p>;

  const mapping = data?.mapping;

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-md p-3 space-y-1.5">
        {!mapping && <p className="text-xs text-muted-foreground">Not yet provisioned on any router.</p>}
        {mapping && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Router account</span>
              <span className={`inline-flex px-1.5 py-0.5 rounded-sm text-xs font-medium ${PROV_STATUS_COLORS[mapping.status] ?? ""}`}>{mapping.status}</span>
            </div>
            <p className="text-xs text-muted-foreground">Username: <span className="font-mono">{mapping.routerUsername}</span></p>
            {mapping.mikrotikProfileName && <p className="text-xs text-muted-foreground">Profile: <span className="font-mono">{mapping.mikrotikProfileName}</span></p>}
            {mapping.status === "FAILED" && (
              <>
                <p className="text-xs text-red-600">{mapping.lastProvisioningError ?? "Unknown error"}</p>
                <p className="text-xs text-muted-foreground">Attempt {mapping.attemptCount} — the retry sweep will keep trying automatically.</p>
              </>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={handleResetPassword} data-testid="btn-reset-password">
          <KeyRound className="w-3.5 h-3.5 mr-1" /> Reset password
        </Button>
        <Button size="sm" variant="outline" onClick={refreshEverything} data-testid="btn-refresh-provisioning">
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
        </Button>
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-medium">Change plan (upgrade / downgrade)</p>
        <div className="flex gap-2">
          <Select value={newPlanId} onValueChange={setNewPlanId}>
            <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-reprovision-plan"><SelectValue placeholder="Select new plan" /></SelectTrigger>
            <SelectContent>
              {plans.map((p: any) => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name} — KES {Number(p.price).toLocaleString()}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleReprovision} data-testid="btn-reprovision">Apply</Button>
        </div>
      </div>

      {data && data.history.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium mb-1.5">Recent status changes</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {data.history.map((h) => (
              <p key={h.id} className="text-xs text-muted-foreground">
                {new Date(h.createdAt).toLocaleString()} — {h.fromStatus ?? "—"} → {h.toStatus} ({h.reason})
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
