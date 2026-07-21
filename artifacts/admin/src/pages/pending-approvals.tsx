import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { fetchPendingUsers, approveUser, rejectUser, errorMessage, type PendingUserDto } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Check, X } from "lucide-react";

const ROLE_OPTIONS = ["BUSINESS_OWNER", "STAFF", "TECHNICIAN", "RESELLER", "SUPER_ADMIN"];

export default function PendingApprovalsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<PendingUserDto[] | null>(null);
  const [roleChoice, setRoleChoice] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const canManage = user?.roles?.includes("SUPER_ADMIN") || user?.roles?.includes("BUSINESS_OWNER");

  async function load() {
    try {
      const { users } = await fetchPendingUsers();
      setUsers(users);
    } catch (err) {
      setError(errorMessage(err, "Failed to load pending users"));
    }
  }

  useEffect(() => { if (canManage) load(); }, [canManage]);

  async function handleApprove(id: string) {
    const role = roleChoice[id] ?? "STAFF";
    setBusyId(id);
    try {
      await approveUser(id, role);
      toast({ title: "User approved", description: `Assigned role: ${role}` });
      await load();
    } catch (err) {
      toast({ title: "Approval failed", description: errorMessage(err, "Please try again"), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    if (!confirm("Reject this registration?")) return;
    setBusyId(id);
    try {
      await rejectUser(id);
      toast({ title: "User rejected" });
      await load();
    } catch (err) {
      toast({ title: "Rejection failed", description: errorMessage(err, "Please try again"), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  if (!canManage) {
    return (
      <AppLayout>
        <div className="p-6 max-w-2xl">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldAlert className="w-4 h-4" /> Only Super Admins and Business Owners can review pending accounts.
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-4 max-w-4xl">
        <div>
          <h1 className="text-lg font-bold">Pending Approvals</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Self-registered accounts waiting for a role assignment before they can sign in.
          </p>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        {users === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : users.length === 0 ? (
          <div className="bg-card border border-border rounded-md p-6 text-center text-sm text-muted-foreground">
            No pending registrations right now.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-md divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="p-4 flex items-center justify-between gap-4" data-testid={`row-pending-${u.id}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{u.firstName} {u.lastName}</p>
                    <Badge variant="outline" className="text-[10px]">PENDING</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{u.email} · {u.phone ?? "no phone"} · {u.businessLocation ?? "no location"}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Select value={roleChoice[u.id] ?? "STAFF"} onValueChange={(v) => setRoleChoice((r) => ({ ...r, [u.id]: v }))}>
                    <SelectTrigger className="w-40 h-8 text-xs" data-testid={`select-role-${u.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={busyId === u.id} onClick={() => handleApprove(u.id)} data-testid={`btn-approve-${u.id}`}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyId === u.id} onClick={() => handleReject(u.id)} data-testid={`btn-reject-${u.id}`}>
                    <X className="w-3.5 h-3.5 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
