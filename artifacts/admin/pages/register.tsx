import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Wifi, ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { registerAccount, errorMessage } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ThemeToggle } from "@/components/ThemeToggle";

interface FormState {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  businessLocation: string;
  password: string;
  confirmPassword: string;
}

const STEPS = ["Your details", "Your business", "Set a password"];

export default function RegisterPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<FormState>({
    fullName: "", email: "", phone: "", companyName: "", businessLocation: "", password: "", confirmPassword: "",
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (form.fullName.trim().length < 2) return "Enter your full name";
      if (!/^\S+@\S+\.\S+$/.test(form.email)) return "Enter a valid email address";
      if (form.phone.trim().length < 7) return "Enter a valid phone number";
    }
    if (step === 1) {
      if (form.companyName.trim().length < 2) return "Enter your company name";
      if (form.businessLocation.trim().length < 1) return "Enter your business location";
    }
    if (step === 2) {
      if (form.password.length < 8) return "Password must be at least 8 characters";
      if (form.password !== form.confirmPassword) return "Passwords do not match";
    }
    return null;
  }

  function next() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError("");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setError("");
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateStep();
    if (err) { setError(err); return; }
    setError("");
    setPending(true);
    try {
      await registerAccount(form);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, "Registration failed. Please try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.35),transparent_45%),radial-gradient(circle_at_80%_75%,rgba(249,115,22,0.28),transparent_45%),linear-gradient(180deg,#0b1224_0%,#070c18_100%)]">
      <div className="absolute top-4 right-4 z-10"><ThemeToggle /></div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-orange-500 mb-4 shadow-lg shadow-primary/30">
            <Wifi className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Create your account</h1>
          <p className="text-sm text-white/50 mt-1">Set up your ISP on PulseNet.</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-2xl p-6">
          {done ? (
            <div className="text-center py-6 space-y-3" data-testid="text-registration-success">
              <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
              <p className="text-sm font-medium text-white">Registration received</p>
              <p className="text-xs text-white/60">
                Your account is pending admin approval. You'll be able to sign in once a Super Admin reviews and approves your registration.
              </p>
              <Link href="/login" className="inline-block mt-2 text-sm text-primary hover:text-orange-400 transition-colors">
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-5">
                <div className="flex justify-between text-xs text-white/50 mb-2">
                  <span>{STEPS[step]}</span>
                  <span>Step {step + 1} of {STEPS.length}</span>
                </div>
                <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5 bg-white/10" />
              </div>

              <form onSubmit={step === STEPS.length - 1 ? submit : (e) => { e.preventDefault(); next(); }} className="space-y-4">
                {step === 0 && (
                  <>
                    <Field label="Full Name" testId="input-fullname" value={form.fullName} onChange={(v) => update("fullName", v)} placeholder="Jane Wanjiru" />
                    <Field label="Email Address" testId="input-reg-email" type="email" value={form.email} onChange={(v) => update("email", v)} placeholder="you@company.com" />
                    <Field label="Phone Number" testId="input-phone" value={form.phone} onChange={(v) => update("phone", v)} placeholder="07XX XXX XXX" />
                  </>
                )}
                {step === 1 && (
                  <>
                    <Field label="Company Name" testId="input-company" value={form.companyName} onChange={(v) => update("companyName", v)} placeholder="Wanjiru Wireless" />
                    <Field label="Business Location" testId="input-location" value={form.businessLocation} onChange={(v) => update("businessLocation", v)} placeholder="Nairobi, Kenya" />
                  </>
                )}
                {step === 2 && (
                  <>
                    <Field label="Password" testId="input-reg-password" type="password" value={form.password} onChange={(v) => update("password", v)} placeholder="At least 8 characters" />
                    <Field label="Confirm Password" testId="input-confirm-password" type="password" value={form.confirmPassword} onChange={(v) => update("confirmPassword", v)} placeholder="Re-enter your password" />
                  </>
                )}

                {error && <p className="text-xs text-red-400" data-testid="text-error">{error}</p>}

                <div className="flex gap-2 pt-1">
                  {step > 0 && (
                    <Button type="button" variant="outline" onClick={back} className="flex-1 border-white/20 text-white/80 hover:bg-white/10 hover:text-white">
                      <ArrowLeft className="w-4 h-4 mr-1" /> Back
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={pending}
                    data-testid={step === STEPS.length - 1 ? "btn-submit-registration" : "btn-next-step"}
                    className="flex-1 bg-gradient-to-r from-primary to-orange-500 hover:opacity-90 text-white font-medium"
                  >
                    {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : step === STEPS.length - 1 ? "Create Account" : <>Next <ArrowRight className="w-4 h-4 ml-1" /></>}
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>

        {!done && (
          <p className="text-center text-xs text-white/40 mt-5">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:text-orange-400 transition-colors" data-testid="link-back-to-login">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", testId }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; testId: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-white/70">{label}</Label>
      <Input
        data-testid={testId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-primary"
      />
    </div>
  );
}
