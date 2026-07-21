import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Wifi, ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { loginRequest, verifyLoginTwoFactor, postLoginDestination, errorMessage } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginAssistant } from "@/components/LoginAssistant";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { setAuth, token } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (token) {
    setLocation("/dashboard");
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await loginRequest(email, password);
      if ("requires2FA" in result) {
        setTempToken(result.tempToken);
      } else {
        setAuth(result.accessToken, result.user);
        setLocation(await postLoginDestination(result.accessToken));
      }
    } catch (err) {
      setError(errorMessage(err, "Invalid email or password"));
    } finally {
      setPending(false);
    }
  }

  async function handleVerify2FA(e: React.FormEvent) {
    e.preventDefault();
    if (!tempToken) return;
    setError("");
    setPending(true);
    try {
      const result = await verifyLoginTwoFactor(tempToken, code);
      setAuth(result.accessToken, result.user);
      setLocation(await postLoginDestination(result.accessToken));
    } catch (err) {
      setError(errorMessage(err, "Invalid verification code"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.35),transparent_45%),radial-gradient(circle_at_80%_75%,rgba(249,115,22,0.28),transparent_45%),linear-gradient(180deg,#0b1224_0%,#070c18_100%)]">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-orange-500 mb-4 shadow-lg shadow-primary/30">
            <Wifi className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Welcome Back</h1>
          <p className="text-sm text-white/50 mt-1">Manage your network intelligently.</p>
        </div>

        {/* Glass card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-2xl p-6">
          {!tempToken ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-white/70">Email</Label>
                <Input
                  id="email"
                  data-testid="input-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-medium text-white/70">Password</Label>
                  <Link href="/forgot-password" className="text-xs text-primary hover:text-orange-400 transition-colors" data-testid="link-forgot-password">
                    Forgot Password?
                  </Link>
                </div>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-primary"
                />
              </div>
              {error && <p className="text-xs text-red-400" data-testid="text-error">{error}</p>}
              <Button
                type="submit"
                data-testid="btn-login"
                disabled={pending}
                className="w-full bg-gradient-to-r from-primary to-orange-500 hover:opacity-90 text-white font-medium shadow-lg shadow-primary/20"
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Login"}
              </Button>
              <Link
                href="/register"
                data-testid="link-create-account"
                className="block w-full text-center text-sm text-white/70 hover:text-white border border-white/15 rounded-md py-2 transition-colors"
              >
                Create Account
              </Link>
            </form>
          ) : (
            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div>
                <p className="text-sm font-medium text-white">Two-factor verification</p>
                <p className="text-xs text-white/50 mt-1">Enter the 6-digit code from your authenticator app.</p>
              </div>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={code} onChange={setCode} data-testid="input-2fa-code">
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} className="bg-white/10 border-white/20 text-white" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {error && <p className="text-xs text-red-400 text-center" data-testid="text-error">{error}</p>}
              <Button
                type="submit"
                data-testid="btn-verify-2fa"
                disabled={pending || code.length !== 6}
                className="w-full bg-gradient-to-r from-primary to-orange-500 hover:opacity-90 text-white font-medium"
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Sign In"}
              </Button>
              <button
                type="button"
                onClick={() => { setTempToken(null); setCode(""); setError(""); }}
                className="w-full text-center text-xs text-white/50 hover:text-white transition-colors"
              >
                Back to login
              </button>
            </form>
          )}
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-5 text-[11px] text-white/40">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          256-bit encrypted · Enterprise-grade security
        </div>

        <div className="flex justify-center mt-4">
          <LoginAssistant />
        </div>

        <p className="text-center text-xs text-white/25 mt-6">Powered by PulseNet AI</p>
      </div>
    </div>
  );
}
