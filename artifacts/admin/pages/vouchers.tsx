import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListVoucherBatches, getListVoucherBatchesQueryKey, useCreateVoucherBatch,
  useGetVoucherBatch, getGetVoucherBatchQueryKey,
  useListVouchers, getListVouchersQueryKey,
  useListPlans, useListRouters, getListRoutersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronRight, ArrowLeft, Router as RouterIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const VOUCHER_STATUS_COLORS: Record<string, string> = {
  UNUSED: "bg-green-500/10 text-green-700",
  USED: "bg-blue-500/10 text-blue-700",
  EXPIRED: "bg-red-500/10 text-red-700",
  VOID: "bg-gray-100 text-gray-500",
};

// Sentinel used only for the Select's own internal value (Radix Select
// forbids an empty-string item value) — never sent to the API. Deliberately
// distinct from the empty string so it can't collide with a real router id.
const NO_ROUTER_RESTRICTION = "__any__";

const schema = z.object({
  planId: z.string().uuid(),
  name: z.string().min(1),
  quantity: z.coerce.number().min(1).max(500),
  unitPrice: z.string().min(1),
  codePrefix: z.string().optional(),
  routerId: z.string().optional(),
});

type BatchForm = z.infer<typeof schema>;

export default function VouchersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [voucherStatusFilter, setVoucherStatusFilter] = useState("");

  const { data: batches, isLoading } = useListVoucherBatches({}, { query: { queryKey: getListVoucherBatchesQueryKey({}) } });
  const { data: plans } = useListPlans({}, { query: { queryKey: ["plans-voucher-sel"] as any } });
  const { data: routers } = useListRouters({}, { query: { queryKey: getListRoutersQueryKey({}) } });
  const createMut = useCreateVoucherBatch();

  const { data: batchDetail } = useGetVoucherBatch(selectedBatch!, { query: { enabled: !!selectedBatch, queryKey: getGetVoucherBatchQueryKey(selectedBatch!) } });

  const vParams = { page: 1, limit: 50, ...(voucherStatusFilter ? { status: voucherStatusFilter as any } : {}) };
  const { data: vouchers } = useListVouchers(selectedBatch!, vParams, { query: { enabled: !!selectedBatch, queryKey: getListVouchersQueryKey(selectedBatch!, vParams) } });

  const form = useForm<BatchForm>({ resolver: zodResolver(schema), defaultValues: { planId: "", name: "", quantity: 10, unitPrice: "", codePrefix: "", routerId: NO_ROUTER_RESTRICTION } });

  function onSubmit(values: BatchForm) {
    createMut.mutate({ data: { ...values, codePrefix: values.codePrefix || undefined, routerId: values.routerId && values.routerId !== NO_ROUTER_RESTRICTION ? values.routerId : undefined } }, {
      onSuccess: () => { toast({ title: `Batch created with ${values.quantity} vouchers` }); qc.invalidateQueries({ queryKey: getListVoucherBatchesQueryKey() }); setOpen(false); form.reset(); },
      onError: () => toast({ title: "Failed to create batch", variant: "destructive" }),
    });
  }

  if (selectedBatch) {
    return (
      <AppLayout>
        <div className="p-6 space-y-4 max-w-5xl">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedBatch(null)} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /></button>
            <div className="flex-1">
              <h1 className="text-lg font-bold">{batchDetail?.name ?? "Batch"}</h1>
              <p className="text-xs text-muted-foreground">{batchDetail?.planName} — KES {Number(batchDetail?.unitPrice ?? 0).toLocaleString()} each</p>
            </div>
            <div className="flex gap-4 text-xs">
              <div className="text-center"><p className="font-bold text-green-600">{batchDetail?.unusedCount ?? 0}</p><p className="text-muted-foreground">Unused</p></div>
              <div className="text-center"><p className="font-bold text-blue-600">{batchDetail?.usedCount ?? 0}</p><p className="text-muted-foreground">Used</p></div>
              <div className="text-center"><p className="font-bold text-red-600">{batchDetail?.expiredCount ?? 0}</p><p className="text-muted-foreground">Expired</p></div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={voucherStatusFilter} onValueChange={setVoucherStatusFilter}>
              <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                {["UNUSED", "USED", "EXPIRED", "VOID"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="bg-card border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {["Code", "Status", "Used At", "Expires"].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vouchers?.data?.map(v => (
                  <tr key={v.id} data-testid={`row-voucher-${v.id}`}>
                    <td className="px-4 py-2 font-mono text-xs font-medium">{v.code}</td>
                    <td className="px-4 py-2"><span className={`inline-flex px-1.5 py-0.5 rounded-sm text-xs font-medium ${VOUCHER_STATUS_COLORS[v.status] ?? ""}`}>{v.status}</span></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{v.usedAt ? new Date(v.usedAt).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{v.expiresAt ? new Date(v.expiresAt).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
                {!vouchers?.data?.length && <tr><td colSpan={4} className="text-center py-8 text-xs text-muted-foreground">No vouchers</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-4 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Vouchers</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{batches?.length ?? 0} batches</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="btn-add-batch"><Plus className="w-3.5 h-3.5 mr-1" /> New Batch</Button>
        </div>

        <div className="bg-card border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Batch Name", "Plan", "Qty", "Price", "Status", ""].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground">Loading...</td></tr>}
              {!isLoading && !batches?.length && <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground">No batches</td></tr>}
              {batches?.map(b => (
                <tr key={b.id} data-testid={`row-batch-${b.id}`} className="hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedBatch(b.id)}>
                  <td className="px-4 py-2.5 text-xs font-medium">{b.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{b.planName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{b.quantity}</td>
                  <td className="px-4 py-2.5 text-xs">KES {Number(b.unitPrice).toLocaleString()}</td>
                  <td className="px-4 py-2.5"><span className={`inline-flex px-1.5 py-0.5 rounded-sm text-xs font-medium ${b.isActive ? "bg-green-500/10 text-green-700" : "bg-gray-100 text-gray-500"}`}>{b.isActive ? "Active" : "Inactive"}</span>
                    {b.routerId && <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-xs font-medium bg-muted text-muted-foreground" title="Restricted to one hotspot"><RouterIcon className="w-2.5 h-2.5" />1 hotspot</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right"><ChevronRight className="w-3.5 h-3.5 text-muted-foreground inline" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Voucher Batch</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Batch Name</FormLabel><FormControl><Input {...field} data-testid="input-batch-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="planId" render={({ field }) => (
                <FormItem><FormLabel>Plan</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger data-testid="select-batch-plan"><SelectValue placeholder="Select plan" /></SelectTrigger></FormControl>
                    <SelectContent>{(plans as any)?.map((p: any) => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="quantity" render={({ field }) => (
                  <FormItem><FormLabel>Quantity</FormLabel><FormControl><Input {...field} type="number" min={1} max={500} data-testid="input-quantity" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="unitPrice" render={({ field }) => (
                  <FormItem><FormLabel>Price (KES)</FormLabel><FormControl><Input {...field} data-testid="input-unit-price" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="codePrefix" render={({ field }) => (
                <FormItem><FormLabel>Code Prefix (optional)</FormLabel><FormControl><Input {...field} placeholder="PN" data-testid="input-prefix" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="routerId" render={({ field }) => (
                <FormItem><FormLabel>Restrict to hotspot (optional)</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger data-testid="select-batch-router"><SelectValue placeholder="Any hotspot" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value={NO_ROUTER_RESTRICTION} className="text-xs">Any hotspot (no restriction)</SelectItem>
                      {routers?.map((r: any) => <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">When set, these vouchers can only be redeemed by a device connecting through this specific hotspot's captive portal.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending} data-testid="btn-submit-batch">Generate Vouchers</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
