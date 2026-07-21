import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Building2, Image, CreditCard, MessageSquare, Router as RouterIcon,
  Zap, UserPlus, Rocket, Check, ArrowRight, ArrowLeft, Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchTenant, updateTenant, completeOnboarding, errorMessage } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

interface Step {
  title: string;
  description: string;
  icon: typeof Building2;
}

const STEPS: Step[] = [
  { title: "Company Information", description: "Confirm your business name.", icon: Building2 },
  { title: "Brand Logo", description: "Add a logo customers will see on invoices and the portal.", icon: Image },
  { title: "Payment Configuration", description: "M-Pesa/Daraja integration — connect this once you have API credentials.", icon: CreditCard },
  { title: "SMS/WhatsApp Gateway", description: "Connect a provider to send customers alerts and OTPs.", icon: MessageSquare },
  { title: "Router Connection", description: "Add your first MikroTik router.", icon: RouterIcon },
  { title: "Create Internet Packages", description: "Set up the plans customers can buy.", icon: Zap },
  { title: "Invite Staff", description: "Bring your team onto PulseNet.", icon: UserPlus },
  { title: "Launch Portal", description: "You're ready to go live.", icon: Rocket },
];

export default function SetupWizardPage() {
  const { token, user } = useAuth();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    fetchTenant().then(({ tenant }) => {
      setCompanyName(tenant.name);
      setLogoUrl(tenant.logoUrl ?? "");
    }).catch(() => {});
  }, [token]);

  if (!token) { setLocation("/login"); return null; }

  async function saveCompanyInfo() {
    setPending(true);
    setError("");
    try {
      await updateTenant({ name: companyName });
      setStep((s) => s + 1);
    } catch (err) {
      setError(errorMessage(err, "Could not save company info"));
    } finally {
      setPending(false);
    }
  }

  async function saveLogo() {
    setPending(true);
    setError("");
    try {
      await updateTenant({ logoUrl: logoUrl || undefined });
      setStep((s) => s + 1);
    } catch (err) {
      setError(errorMessage(err, "Could not save logo"));
    } finally {
      setPending(false);
    }
  }

  async function finish() {
    setPending(true);
    setError("");
    try {
      await completeOnboarding();
      setLocation("/");
    } catch (err) {
      setError(errorMessage(err, "Could not complete setup"));
    } finally {
      setPending(false);
    }
  }

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">Welcome to PulseNet, {user?.firstName}</h1>
          <p className="text-sm text-muted-foreground mt-1">Let's set up your business.</p>
        </div>

        <div className="mb-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>{current.title}</span>
            <span>Step {step + 1} of {STEPS.length}</span>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 grid place-items-center shrink-0">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">{current.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{current.description}</p>
            </div>
          </div>

          {step === 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Company Name</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} data-testid="input-wizard-company" />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Logo URL (optional)</Label>
              <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" data-testid="input-wizard-logo" />
            </div>
          )}

          {(step === 2 || step === 3) && (
            <p className="text-xs text-muted-foreground bg-muted rounded-md p-3">
              This integration isn't connected yet — it needs real provider credentials. You can configure it later from Settings once those are available.
            </p>
          )}

          {step === 4 && (
            <Link href="/routers" className="text-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="link-wizard-routers">
              Go to Routers <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
          {step === 5 && (
            <Link href="/plans" className="text-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="link-wizard-plans">
              Go to Packages <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
          {step === 6 && (
            <Link href="/users" className="text-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="link-wizard-users">
              Go to Staff Users <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
          {step === 7 && (
            <p className="text-xs text-muted-foreground bg-muted rounded-md p-3 flex items-center gap-2">
              <Check className="w-4 h-4 text-primary" /> Everything's set. Finish to head to your dashboard.
            </p>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 pt-1">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={pending} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            )}
            {step === 0 ? (
              <Button onClick={saveCompanyInfo} disabled={pending} className="flex-1" data-testid="btn-wizard-next">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Next <ArrowRight className="w-4 h-4 ml-1" /></>}
              </Button>
            ) : step === 1 ? (
              <Button onClick={saveLogo} disabled={pending} className="flex-1" data-testid="btn-wizard-next">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Next <ArrowRight className="w-4 h-4 ml-1" /></>}
              </Button>
            ) : step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} className="flex-1" data-testid="btn-wizard-next">
                Next <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={finish} disabled={pending} className="flex-1" data-testid="btn-wizard-finish">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Launch Portal"}
              </Button>
            )}
          </div>
        </div>

        <button onClick={() => setLocation("/")} className="block mx-auto mt-4 text-xs text-muted-foreground hover:text-foreground">
          Skip for now
        </button>
      </div>
    </div>
  );
}
