import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { getNocSettings, updateNocSettings } from "@/lib/noc-api";

export function NocSettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const settings = useQuery({ queryKey: ["noc", "settings"], queryFn: getNocSettings });

  const [autoRemediation, setAutoRemediation] = useState(false);
  const [llmNarrative, setLlmNarrative] = useState(true);
  const [pollInterval, setPollInterval] = useState(60);
  const [analysisInterval, setAnalysisInterval] = useState(180);
  const [retentionDays, setRetentionDays] = useState(90);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = settings.data?.settings;
    if (!s) return;
    setAutoRemediation(s.autoRemediationEnabled); setLlmNarrative(s.llmNarrativeEnabled);
    setPollInterval(s.pollIntervalSeconds); setAnalysisInterval(s.analysisIntervalSeconds); setRetentionDays(s.snapshotRetentionDays);
  }, [settings.data]);

  async function save() {
    setSaving(true);
    const result = await updateNocSettings({
      autoRemediationEnabled: autoRemediation, llmNarrativeEnabled: llmNarrative,
      pollIntervalSeconds: pollInterval, analysisIntervalSeconds: analysisInterval, snapshotRetentionDays: retentionDays,
    }).catch((err) => { toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }); return null; });
    setSaving(false);
    if (result) { toast({ title: "AI NOC settings saved" }); qc.invalidateQueries({ queryKey: ["noc", "settings"] }); }
  }

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h2 className="text-base font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />AI NOC</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Monitoring cadence and automation policy. Full dashboard (incidents, recommendations, forecasts) lives at{" "}
          <Link href="/network-monitor?view=ai" className="text-primary hover:underline">Network Monitor → AI NOC</Link>.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-run safe actions</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Off by default. When on, SAFE-tier recommendations (restart monitoring, retry provisioning, disconnect an orphaned session) execute automatically instead of waiting for a staff click. Anything touching a customer's subscription always requires approval regardless of this setting.</p>
            </div>
            <Switch checked={autoRemediation} onCheckedChange={setAutoRemediation} disabled={!isAdmin} className="shrink-0 ml-4" />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div>
              <Label>AI-written narratives</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Use the configured LLM to write root-cause explanations and incident reports. When off (or no API key is configured server-side), the NOC still works — it just shows rule-based summaries instead of prose.</p>
            </div>
            <Switch checked={llmNarrative} onCheckedChange={setLlmNarrative} disabled={!isAdmin} className="shrink-0 ml-4" />
          </div>
          <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border">
            <div className="space-y-1.5"><Label className="text-xs">Poll interval (sec)</Label><Input type="number" min={15} max={3600} value={pollInterval} onChange={(e) => setPollInterval(Number(e.target.value))} disabled={!isAdmin} data-testid="input-noc-poll-interval" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Analysis interval (sec)</Label><Input type="number" min={30} max={3600} value={analysisInterval} onChange={(e) => setAnalysisInterval(Number(e.target.value))} disabled={!isAdmin} data-testid="input-noc-analysis-interval" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Snapshot retention (days)</Label><Input type="number" min={7} max={730} value={retentionDays} onChange={(e) => setRetentionDays(Number(e.target.value))} disabled={!isAdmin} data-testid="input-noc-retention" /></div>
          </div>
          {isAdmin && <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save</Button>}
        </CardContent>
      </Card>
    </div>
  );
}
