import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListUsers, getListUsersQueryKey, useCreateUser, useDeleteUser } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Shield } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8, "Min 8 characters"),
});

type UserForm = z.infer<typeof schema>;

export default function UsersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: users, isLoading } = useListUsers({}, { query: { queryKey: getListUsersQueryKey({}) } });
  const createMut = useCreateUser();
  const deleteMut = useDeleteUser();

  const form = useForm<UserForm>({ resolver: zodResolver(schema), defaultValues: { firstName: "", lastName: "", email: "", phone: "", password: "" } });

  function onSubmit(values: UserForm) {
    createMut.mutate({ data: { ...values, roles: ["staff"] } }, {
      onSuccess: () => { toast({ title: "User invited" }); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); setOpen(false); form.reset(); },
      onError: () => toast({ title: "Failed to create user", variant: "destructive" }),
    });
  }

  function handleDelete(id: string, email: string) {
    if (!confirm(`Deactivate ${email}?`)) return;
    deleteMut.mutate({ id }, { onSuccess: () => { toast({ title: "User deactivated" }); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); } });
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-4 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Staff Users</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{users?.length ?? 0} members</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="btn-add-user"><Plus className="w-3.5 h-3.5 mr-1" /> Invite User</Button>
        </div>

        <div className="bg-card border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Name", "Email", "Phone", "Roles", "Status", "Actions"].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground">Loading...</td></tr>}
              {!isLoading && !users?.length && <tr><td colSpan={6} className="text-center py-8 text-xs text-muted-foreground">No users</td></tr>}
              {users?.map(u => (
                <tr key={u.id} data-testid={`row-user-${u.id}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Shield className="w-3 h-3 text-primary" />
                      </div>
                      <span className="text-xs font-medium">{u.firstName} {u.lastName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{u.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {u.roles?.map(r => <span key={r} className="px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground text-xs">{r}</span>)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-1.5 py-0.5 rounded-sm text-xs font-medium ${u.isActive ? "bg-green-500/10 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {u.isActive && (
                      <button onClick={() => handleDelete(u.id, u.email)} className="p-1 rounded hover:bg-muted transition-colors" data-testid={`btn-deactivate-${u.id}`}>
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite Staff User</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} data-testid="input-user-first" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} data-testid="input-user-last" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input {...field} type="email" data-testid="input-user-email" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone (optional)</FormLabel><FormControl><Input {...field} data-testid="input-user-phone" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem><FormLabel>Password</FormLabel><FormControl><Input {...field} type="password" data-testid="input-user-password" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending} data-testid="btn-submit-user">Invite User</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
