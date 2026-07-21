import { useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, KeyRound, UserPlus, LifeBuoy, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function LoginAssistant() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  const options = [
    { icon: KeyRound, label: "Password recovery", onClick: () => setLocation("/forgot-password") },
    { icon: UserPlus, label: "Account setup", onClick: () => setLocation("/register") },
    { icon: LifeBuoy, label: "Contact support", onClick: () => window.open("mailto:support@pulsenet.app", "_blank") },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="btn-login-assistant"
          className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Need help accessing your account?
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 p-2">
        <div className="flex items-center justify-between px-2 py-1">
          <p className="text-xs font-semibold text-muted-foreground">AI Login Assistant</p>
          <button onClick={() => setOpen(false)} aria-label="Close">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <div className="space-y-1 mt-1">
          {options.map(({ icon: Icon, label, onClick }) => (
            <button
              key={label}
              onClick={() => { onClick(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-left hover:bg-accent transition-colors"
            >
              <Icon className="w-4 h-4 text-primary" />
              {label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
