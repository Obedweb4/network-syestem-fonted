import { useState } from "react";
import { Link, useSearch } from "wouter";
import { Wifi, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { resetPassword, errorMessage } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function ResetPasswordPage() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    setError("");
    setPending(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, "That reset link is invalid or has expired."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.35),transparent_45%),radial-gradient(circle_at_80%_75%,rgba(249,115,22,0.28),transparent_45%),linear-gradient(180deg,#0b1224_0%,#070c18_100%)]">
      <div className="absolute top-4 right-4 z-10"><ThemeToggle /></div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-orange-500 mb-4 shadow-lg shadow-primary/30">
            <Wifi className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Set a new password</h1>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-2xl p-6">
          {!token ? (
            <div className="text-center py-4 space-y-3" data-testid="text-missing-token">
              <AlertTriangle className="w-10 h-10 text-orange-400 mx-auto" />
              <p className="text-sm text-white/80">This link is missing its reset token. Request a new one from the forgot password page.</p>
            </div>
          ) : done ? (
            <div className="text-center py-4 space-y-3" data-testid="text-reset-complete">
              <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
              <p className="text-sm text-white/80">Your password has been updated. Every existing session has been signed out for security.</p>
              <Link href="/login" className="inline-block mt-2 text-sm text-primary hover:text-orange-400 transition-colors">Sign in</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-white/70">New password</Label>
                <Input
                  data-testid="input-new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="At least 8 characters"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-white/70">Confirm new password</Label>
                <Input
                  data-testid="input-confirm-new-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Re-enter your new password"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-primary"
                />
              </div>
              {error && <p className="text-xs text-red-400" data-testid="text-error">{error}</p>}
              <Button
                type="submit"
                data-testid="btn-reset-password"
                disabled={pending}
                className="w-full bg-gradient-to-r from-primary to-orange-500 hover:opacity-90 text-white font-medium"
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update password"}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-white/40 mt-5">
          <Link href="/login" className="text-primary hover:text-orange-400 transition-colors">Back to login</Link>
        </p>
      </div>
    </div>
  );
}
