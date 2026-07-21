import { useState } from "react";
import { Link } from "wouter";
import { Wifi, CheckCircle2, Loader2 } from "lucide-react";
import { forgotPassword, errorMessage } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong. Please try again."));
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
          <h1 className="text-2xl font-bold text-white tracking-tight">Reset your password</h1>
          <p className="text-sm text-white/50 mt-1">We'll send instructions to your registered email.</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-2xl p-6">
          {sent ? (
            <div className="text-center py-4 space-y-3" data-testid="text-reset-sent">
              <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
              <p className="text-sm text-white/80">
                If <span className="font-medium text-white">{email}</span> is registered, we've sent password reset instructions to it.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-white/70">Email address</Label>
                <Input
                  id="email"
                  data-testid="input-forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-primary"
                />
              </div>
              {error && <p className="text-xs text-red-400" data-testid="text-error">{error}</p>}
              <Button
                type="submit"
                data-testid="btn-send-reset"
                disabled={pending}
                className="w-full bg-gradient-to-r from-primary to-orange-500 hover:opacity-90 text-white font-medium"
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reset instructions"}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-white/40 mt-5">
          <Link href="/login" className="text-primary hover:text-orange-400 transition-colors" data-testid="link-back-to-login">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
