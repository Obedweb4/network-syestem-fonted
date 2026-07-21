import { useState, Fragment } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListInvoices, getListInvoicesQueryKey, useCreateInvoice,
  useGetInvoicePayments, getGetInvoicePaymentsQueryKey, useListCustomers,
} from "@workspace/api-client-react";
import { recordInvoicePayment, fetchPaymentsReport } from "@/lib/invoices-api";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Plus, CreditCard, Eye, EyeOff, FileBarChart, Receipt, TrendingUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  PAID: "bg-green-500/10 text-green-700",
  PENDING: "bg-yellow-500/10 text-yellow-700",
  VOID: "bg-gray-100 text-gray-500",
  DRAFT: "bg-blue-500/10 text-blue-700",
};

const PAY_METHOD_COLORS: Record<string, string> = {
  MPESA: "bg-green-500/10 text-green-700",
  CASH: "bg-blue-500/10 text-blue-700",
  WALLET: "bg-purple-500/10 text-purple-700",
  LOYALTY: "bg-orange-500/10 text-orange-700",
};

const invSchema = z.object({
  customerId: z.string().uuid(),
  amount: z.string().min(1),
  dueAt: z.string().min(1),
  notes: z.string().optional(),
});

const paySchema = z.object({
  customerId: z.string().uuid(),
  amount: z.string().min(1),
  method: z.enum(["MPESA", "WALLET", "LOYALTY", "CASH"]),
  reference: z.string().optional(),
});

function PaymentHistoryRow({ invoiceId, totalAmount }: { invoiceId: string; totalAmount: string }) {
  const { data: payments, isLoading } = useGetInvoicePayments(invoiceId, { query: { queryKey: getGetInvoicePaymentsQueryKey(invoiceId) } });

  const totalPaid = (payments ?? []).reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0);
  const due = parseFloat(totalAmount);

  return (
    <tr className="bg-muted/30">
      <td colSpan={7} className="px-4 pb-3 pt-1">
        <div className="text-xs mb-2 flex items-center gap-3">
          <span className="font-medium">Payment History</span>
          <span className="text-muted-foreground">
            Paid: <span className={`font-medium ${totalPaid >= due ? "text-green-700" : "text-orange-600"}`}>KES {totalPaid.toLocaleString()}</span>
            {" / "}Due: KES {due.toLocaleString()}
            {totalPaid > due && <span className="ml-1 text-blue-600">(+KES {(totalPaid - due).toLocaleString()} credit)</span>}
          </span>
        </div>
        {isLoading && <p className="text-xs text-muted-foreground py-2">Loading...</p>}
        {!isLoading && !payments?.length && <p className="text-xs text-muted-foreground py-2">No payments recorded</p>}
        {!isLoading && payments && payments.length > 0 && (
          <table className="w-full text-xs border border-border rounded-sm overflow-hidden">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {["Amount", "Method", "Reference", "Status", "Date"].map(h => (
                  <th key={h} className="text-left px-2 py-1.5 font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payments.map((p: any) => (
                <tr key={p.id} data-testid={`row-payment-${p.id}`}>
                  <td className="px-2 py-1.5 font-medium">KES {parseFloat(p.amount).toLocaleString()}</td>
                  <td className="px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded-sm text-xs ${PAY_METHOD_COLORS[p.method] ?? "bg-gray-100"}`}>{p.method}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">{p.reference ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded-sm ${p.status === "COMPLETED" ? "bg-green-500/10 text-green-700" : "bg-yellow-500/10 text-yellow-700"}`}>{p.status}</span>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

function PaymentsReportView() {
  const { data, isLoading } = useQuery({ queryKey: ["payments-report"], queryFn: fetchPaymentsReport });

  if (isLoading) return <p className="text-xs text-muted-foreground py-8 text-center">Loading…</p>;
  if (!data) return <p className="text-xs text-muted-foreground py-8 text-center">Could not load the report</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-md p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-sm flex items-center justify-center shrink-0 bg-green-500/10 text-green-700"><TrendingUp className="w-4 h-4" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Total Received</p>
            <p className="text-xl font-bold mt-0.5 leading-none" data-testid="stat-total-received">KES {data.totalReceived.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-md p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-sm flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-700"><Receipt className="w-4 h-4" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Completed Payments</p>
            <p className="text-xl font-bold mt-0.5 leading-none" data-testid="stat-payment-count">{data.paymentCount.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-md overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border bg-muted/40"><p className="text-xs font-medium text-muted-foreground">By Payment Method</p></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {["Method", "Total", "Count"].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.byMethod.length === 0 && <tr><td colSpan={3} className="text-center py-6 text-xs text-muted-foreground">No payments recorded yet</td></tr>}
            {data.byMethod.map(row => (
              <tr key={row.method} data-testid={`row-method-${row.method}`}>
                <td className="px-3 py-2 text-xs"><span className={`px-1.5 py-0.5 rounded-sm ${PAY_METHOD_COLORS[row.method] ?? ""}`}>{row.method}</span></td>
                <td className="px-3 py-2 text-xs font-medium">KES {row.total.toLocaleString()}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-border rounded-md overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border bg-muted/40"><p className="text-xs font-medium text-muted-foreground">Recent Payments (last 50)</p></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {["Customer", "Amount", "Method", "Status", "Reference", "Date"].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.recent.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-xs text-muted-foreground">No payments recorded yet</td></tr>}
            {data.recent.map(p => (
              <tr key={p.id} data-testid={`row-payment-${p.id}`}>
                <td className="px-3 py-2 text-xs">{p.customerName ?? "—"}</td>
                <td className="px-3 py-2 text-xs font-medium">KES {Number(p.amount).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs"><span className={`px-1.5 py-0.5 rounded-sm ${PAY_METHOD_COLORS[p.method] ?? ""}`}>{p.method}</span></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{p.status}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{p.reference ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function InvoicesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const view = (new URLSearchParams(search).get("view") ?? "invoices") as "invoices" | "reports";
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [openInv, setOpenInv] = useState(false);
  const [payInvId, setPayInvId] = useState<string | null>(null);
  const [expandedInvId, setExpandedInvId] = useState<string | null>(null);
  const limit = 20;

  const params = { page, limit, ...(statusFilter ? { status: statusFilter as any } : {}) };
  const { data, isLoading } = useListInvoices(params, { query: { queryKey: getListInvoicesQueryKey(params), enabled: view === "invoices" } });
  const { data: customers } = useListCustomers({ limit: 200 }, { query: { queryKey: ["customers-inv-sel"] as any } });
  const createMut = useCreateInvoice();
  // The invoice-scoped POST (not the generated useRecordPayment, which hits
  // the standalone /payments and previously never marked the invoice PAID
  // or debited a WALLET payment — see routes/invoices.ts::applyPaymentEffects).
  const payMut = useMutation({ mutationFn: (vars: { invoiceId: string; data: z.infer<typeof paySchema> }) => recordInvoicePayment(vars.invoiceId, vars.data) });

  const invForm = useForm<z.infer<typeof invSchema>>({ resolver: zodResolver(invSchema), defaultValues: { customerId: "", amount: "", dueAt: new Date().toISOString().slice(0, 10) } });
  const payForm = useForm<z.infer<typeof paySchema>>({ resolver: zodResolver(paySchema), defaultValues: { customerId: "", amount: "", method: "MPESA" } });

  function onCreateInv(values: z.infer<typeof invSchema>) {
    createMut.mutate({ data: { ...values, dueAt: values.dueAt } }, {
      onSuccess: () => { toast({ title: "Invoice created" }); qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() }); setOpenInv(false); invForm.reset(); },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    });
  }

  function openPay(inv: any) {
    setPayInvId(inv.id);
    payForm.reset({ customerId: inv.customerId, amount: inv.totalAmount, method: "MPESA" });
  }

  function onPay(values: z.infer<typeof paySchema>) {
    if (!payInvId) return;
    payMut.mutate({ invoiceId: payInvId, data: values }, {
      onSuccess: () => {
        toast({ title: "Payment recorded" });
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetInvoicePaymentsQueryKey(payInvId) });
        setPayInvId(null);
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    });
  }

  function toggleExpand(invId: string) {
    setExpandedInvId(prev => prev === invId ? null : invId);
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-4 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">{view === "reports" ? "Payment Reports" : "Invoices"}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {view === "reports" ? "Totals received and recent transactions" : `${data?.total ?? 0} total`}
            </p>
          </div>
          {view === "invoices" && (
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  {["DRAFT", "PENDING", "PAID", "VOID"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => setOpenInv(true)} data-testid="btn-add-invoice"><Plus className="w-3.5 h-3.5 mr-1" /> New Invoice</Button>
            </div>
          )}
        </div>

        <Tabs value={view} onValueChange={(v) => setLocation(v === "invoices" ? "/invoices" : `/invoices?view=${v}`)}>
          <TabsList>
            <TabsTrigger value="invoices" className="gap-1.5" data-testid="tab-invoices"><Receipt className="h-3.5 w-3.5" />Invoices</TabsTrigger>
            <TabsTrigger value="reports" className="gap-1.5" data-testid="tab-reports"><FileBarChart className="h-3.5 w-3.5" />Reports</TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "reports" && <PaymentsReportView />}

        {view === "invoices" && (<>
        <div className="bg-card border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Customer", "Amount", "Total", "Status", "Due", "Payments", "Actions"].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan={7} className="text-center py-8 text-xs text-muted-foreground">Loading...</td></tr>}
              {!isLoading && !data?.data?.length && <tr><td colSpan={7} className="text-center py-8 text-xs text-muted-foreground">No invoices</td></tr>}
              {data?.data?.map((inv: any) => (
                <Fragment key={inv.id}>
                  <tr data-testid={`row-invoice-${inv.id}`} className={expandedInvId === inv.id ? "bg-muted/10" : ""}>
                    <td className="px-3 py-2 text-xs">{inv.customerName ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">KES {parseFloat(inv.amount).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs font-medium">KES {parseFloat(inv.totalAmount).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded-sm ${STATUS_COLORS[inv.status] ?? ""}`}>{inv.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{inv.dueAt ? new Date(inv.dueAt).toLocaleDateString() : "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      <button
                        onClick={() => toggleExpand(inv.id)}
                        className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                        data-testid={`btn-expand-${inv.id}`}
                        title="View payment history"
                      >
                        {expandedInvId === inv.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {inv.status !== "PAID" && inv.status !== "VOID" && (
                        <button onClick={() => openPay(inv)} className="text-primary hover:underline flex items-center gap-1" data-testid={`btn-pay-${inv.id}`}>
                          <CreditCard className="w-3 h-3" /> Pay
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedInvId === inv.id && (
                    <PaymentHistoryRow key={`expand-${inv.id}`} invoiceId={inv.id} totalAmount={inv.totalAmount} />
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {data && data.total > limit && (
            <div className="px-4 py-3 border-t border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(data.total / limit)}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
                <Button size="sm" variant="outline" onClick={() => setPage(p => p + 1)} disabled={page * limit >= data.total}>Next</Button>
              </div>
            </div>
          )}
        </div>
        </>)}

        {/* Create Invoice Dialog */}
        <Dialog open={openInv} onOpenChange={setOpenInv}>
          <DialogContent>
            <DialogHeader><DialogTitle>New Invoice</DialogTitle></DialogHeader>
            <Form {...invForm}>
              <form onSubmit={invForm.handleSubmit(onCreateInv)} className="space-y-3">
                <FormField control={invForm.control} name="customerId" render={({ field }) => (
                  <FormItem><FormLabel>Customer</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {customers?.data?.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={invForm.control} name="amount" render={({ field }) => (<FormItem><FormLabel>Amount (KES)</FormLabel><FormControl><Input {...field} type="number" step="0.01" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={invForm.control} name="dueAt" render={({ field }) => (<FormItem><FormLabel>Due Date</FormLabel><FormControl><Input {...field} type="date" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={invForm.control} name="notes" render={({ field }) => (<FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpenInv(false)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={createMut.isPending}>Create</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Record Payment Dialog */}
        <Dialog open={!!payInvId} onOpenChange={o => { if (!o) setPayInvId(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
            <Form {...payForm}>
              <form onSubmit={payForm.handleSubmit(onPay)} className="space-y-3">
                <FormField control={payForm.control} name="amount" render={({ field }) => (<FormItem><FormLabel>Amount (KES)</FormLabel><FormControl><Input {...field} type="number" step="0.01" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={payForm.control} name="method" render={({ field }) => (
                  <FormItem><FormLabel>Payment Method</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {["MPESA", "CASH", "WALLET", "LOYALTY"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={payForm.control} name="reference" render={({ field }) => (<FormItem><FormLabel>Reference / Transaction ID</FormLabel><FormControl><Input {...field} placeholder="e.g. QA12BCD456" /></FormControl><FormMessage /></FormItem>)} />
                <p className="text-xs text-muted-foreground">Note: partial payments are accepted. Invoice status auto-updates to PAID when fully settled.</p>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPayInvId(null)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={payMut.isPending}>
                    <CreditCard className="w-3.5 h-3.5 mr-1" /> Record Payment
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
