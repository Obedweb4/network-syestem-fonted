import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListCustomers, getListCustomersQueryKey, useCreateCustomer,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Plus, ChevronRight, User } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const createSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  nationalId: z.string().optional(),
  address: z.string().optional(),
});

type CreateForm = z.infer<typeof createSchema>;

export default function CustomersPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const limit = 20;
  const params = { page, limit, search: search || undefined };
  const { data, isLoading } = useListCustomers(params, { query: { queryKey: getListCustomersQueryKey(params) } });
  const createMut = useCreateCustomer();

  const form = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { firstName: "", lastName: "", phone: "", email: "", nationalId: "", address: "" } });

  function onSubmit(values: CreateForm) {
    createMut.mutate({ data: { ...values, email: values.email || undefined } }, {
      onSuccess: () => {
        toast({ title: "Client created" });
        qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setOpen(false);
        form.reset();
      },
      onError: () => toast({ title: "Failed to create client", variant: "destructive" }),
    });
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-4 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Clients</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{data?.total ?? 0} total</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="btn-add-customer">
            <Plus className="w-3.5 h-3.5 mr-1" /> New Client
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            data-testid="input-search-customers"
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Search clients by name or phone..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <div className="bg-card border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Phone</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Email</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Joined</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground">Loading...</td></tr>
              )}
              {!isLoading && !data?.data?.length && (
                <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground">No clients found</td></tr>
              )}
              {data?.data?.map(c => (
                <tr
                  key={c.id}
                  data-testid={`row-customer-${c.id}`}
                  className="hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => setLocation(`/customers/${c.id}`)}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="w-3 h-3 text-primary" />
                      </div>
                      <span className="font-medium text-xs">{c.firstName} {c.lastName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.phone}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs font-medium ${c.isActive ? "bg-green-500/10 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {c.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-right"><ChevronRight className="w-3.5 h-3.5 text-muted-foreground inline" /></td>
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
          <DialogHeader><DialogTitle>New Client</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} data-testid="input-first-name" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} data-testid="input-last-name" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone *</FormLabel><FormControl><Input {...field} placeholder="+254700000000" data-testid="input-phone" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input {...field} type="email" data-testid="input-email" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="nationalId" render={({ field }) => (
                <FormItem><FormLabel>National ID</FormLabel><FormControl><Input {...field} data-testid="input-national-id" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem><FormLabel>Address</FormLabel><FormControl><Input {...field} data-testid="input-address" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending} data-testid="btn-submit-customer">
                  {createMut.isPending ? "Creating..." : "Create Client"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
