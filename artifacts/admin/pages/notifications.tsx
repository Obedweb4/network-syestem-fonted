import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListNotificationTemplates, getListNotificationTemplatesQueryKey,
  useCreateNotificationTemplate, useUpdateNotificationTemplate, useDeleteNotificationTemplate,
  useListNotificationLogs, getListNotificationLogsQueryKey,
  useListCustomers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(1),
  channel: z.enum(["SMS", "EMAIL", "WHATSAPP"]),
  bodyTemplate: z.string().min(1),
  subject: z.string().optional(),
});

type TmplForm = z.infer<typeof schema>;

const sendSchema = z.object({
  customerId: z.string().optional(),
  channel: z.enum(["SMS", "EMAIL", "WHATSAPP"]),
  recipient: z.string().min(1, "Recipient is required"),
  templateId: z.string().optional(),
});

type SendForm = z.infer<typeof sendSchema>;

const LOG_STATUS_COLORS: Record<string, string> = {
  SENT: "bg-green-500/10 text-green-700",
  DELIVERED: "bg-blue-500/10 text-blue-700",
  FAILED: "bg-red-500/10 text-red-700",
  QUEUED: "bg-yellow-500/10 text-yellow-700",
};

export default function NotificationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"templates" | "logs">("templates");
  const [open, setOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const { data: templates, isLoading: tmplLoading } = useListNotificationTemplates({ query: { queryKey: getListNotificationTemplatesQueryKey() } });
  const { data: logs, isLoading: logsLoading } = useListNotificationLogs({ page: 1, limit: 50 }, { query: { queryKey: getListNotificationLogsQueryKey({ page: 1, limit: 50 }) } });
  const { data: customers } = useListCustomers({ limit: 200 }, { query: { queryKey: ["customers-notif-sel"] as any } });

  const createMut = useCreateNotificationTemplate();
  const updateMut = useUpdateNotificationTemplate();
  const deleteMut = useDeleteNotificationTemplate();

  const form = useForm<TmplForm>({ resolver: zodResolver(schema), defaultValues: { name: "", channel: "SMS", bodyTemplate: "" } });
  const sendForm = useForm<SendForm>({ resolver: zodResolver(sendSchema), defaultValues: { channel: "SMS", recipient: "" } });

  function openCreate() { setEditId(null); form.reset({ name: "", channel: "SMS", bodyTemplate: "" }); setOpen(true); }
  function openEdit(t: any) { setEditId(t.id); form.reset({ name: t.name, channel: t.channel, bodyTemplate: t.bodyTemplate, subject: t.subject }); setOpen(true); }

  function onSubmit(values: TmplForm) {
    if (editId) {
      updateMut.mutate({ id: editId, data: values }, {
        onSuccess: () => { toast({ title: "Template updated" }); qc.invalidateQueries({ queryKey: getListNotificationTemplatesQueryKey() }); setOpen(false); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      });
    } else {
      createMut.mutate({ data: values }, {
        onSuccess: () => { toast({ title: "Template created" }); qc.invalidateQueries({ queryKey: getListNotificationTemplatesQueryKey() }); setOpen(false); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      });
    }
  }

  async function onSend(values: SendForm) {
    setSending(true);
    try {
      const token = sessionStorage.getItem("pn_token");
      const res = await fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customerId: values.customerId || undefined,
          channel: values.channel,
          recipient: values.recipient,
          templateId: values.templateId || undefined,
        }),
      });
      if (res.ok) {
        toast({ title: "Notification sent" });
        qc.invalidateQueries({ queryKey: getListNotificationLogsQueryKey({ page: 1, limit: 50 }) });
        setSendOpen(false);
        sendForm.reset({ channel: "SMS", recipient: "" });
        setTab("logs");
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.error ?? "Failed to send", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this template?")) return;
    deleteMut.mutate({ id }, { onSuccess: () => { toast({ title: "Deleted" }); qc.invalidateQueries({ queryKey: getListNotificationTemplatesQueryKey() }); } });
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-4 max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Notifications</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setSendOpen(true)} data-testid="btn-send-notification">
              <Send className="w-3.5 h-3.5 mr-1" /> Send Notification
            </Button>
            <Button size="sm" onClick={openCreate} data-testid="btn-new-template">
              <Plus className="w-3.5 h-3.5 mr-1" /> New Template
            </Button>
          </div>
        </div>

        <div className="flex gap-2 border-b border-border">
          {(["templates", "logs"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-xs font-medium capitalize border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>
          ))}
        </div>

        {tab === "templates" && (
          <div className="space-y-2">
            {tmplLoading && <p className="text-xs text-muted-foreground text-center py-8">Loading...</p>}
            {!tmplLoading && !templates?.length && <p className="text-xs text-muted-foreground text-center py-8">No templates yet</p>}
            {templates?.map(t => (
              <div key={t.id} data-testid={`card-template-${t.id}`} className="bg-card border border-border rounded-md p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{t.name}</p>
                    <span className="text-xs px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">{t.channel}</span>
                  </div>
                  {t.subject && <p className="text-xs text-muted-foreground mt-0.5">{t.subject}</p>}
                  <p className="text-xs text-muted-foreground mt-1 truncate max-w-xl">{t.bodyTemplate}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(t)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-sm" data-testid={`btn-edit-template-${t.id}`}><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 text-muted-foreground hover:text-destructive rounded-sm" data-testid={`btn-del-template-${t.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "logs" && (
          <div className="bg-card border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/40">{["Customer", "Channel", "Recipient", "Status", "Sent At"].map(h => <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {logsLoading && <tr><td colSpan={5} className="text-center py-8 text-xs text-muted-foreground">Loading...</td></tr>}
                {!logsLoading && !logs?.data?.length && <tr><td colSpan={5} className="text-center py-8 text-xs text-muted-foreground">No notifications sent yet</td></tr>}
                {logs?.data?.map(l => (
                  <tr key={l.id} data-testid={`row-log-${l.id}`}>
                    <td className="px-3 py-2 text-xs">{(l as any).customerName ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{l.channel}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{l.recipient}</td>
                    <td className="px-3 py-2 text-xs"><span className={`px-1.5 py-0.5 rounded-sm ${LOG_STATUS_COLORS[l.status] ?? ""}`}>{l.status}</span></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{l.sentAt ? new Date(l.sentAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Template CRUD Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Edit Template" : "New Template"}</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="channel" render={({ field }) => (<FormItem><FormLabel>Channel</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{["SMS", "EMAIL", "WHATSAPP"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="subject" render={({ field }) => (<FormItem><FormLabel>Subject (optional)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="bodyTemplate" render={({ field }) => (<FormItem><FormLabel>Message Template</FormLabel><FormControl><textarea {...field} rows={4} className="w-full text-sm border border-input rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring" placeholder="Hello {firstName}, your invoice {invoiceNumber} is due..." /></FormControl><FormMessage /></FormItem>)} />
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={createMut.isPending || updateMut.isPending}>{editId ? "Update" : "Create"}</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Send Notification Dialog */}
        <Dialog open={sendOpen} onOpenChange={setSendOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Send Notification</DialogTitle></DialogHeader>
            <Form {...sendForm}>
              <form onSubmit={sendForm.handleSubmit(onSend)} className="space-y-3">
                <FormField control={sendForm.control} name="customerId" render={({ field }) => (
                  <FormItem><FormLabel>Customer (optional)</FormLabel>
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="">No customer</SelectItem>
                        {customers?.data?.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={sendForm.control} name="channel" render={({ field }) => (
                  <FormItem><FormLabel>Channel</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{["SMS", "EMAIL", "WHATSAPP"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={sendForm.control} name="recipient" render={({ field }) => (
                  <FormItem><FormLabel>Recipient (phone / email)</FormLabel>
                    <FormControl><Input {...field} placeholder="0712345678 or user@example.com" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={sendForm.control} name="templateId" render={({ field }) => (
                  <FormItem><FormLabel>Template (optional)</FormLabel>
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="">No template</SelectItem>
                        {templates?.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name} ({t.channel})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSendOpen(false)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={sending}>
                    <Send className="w-3.5 h-3.5 mr-1" /> {sending ? "Sending..." : "Send"}
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
