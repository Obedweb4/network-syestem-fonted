import { useQuery } from "@tanstack/react-query";
import { Loader2, ScrollText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getNocLogs } from "@/lib/noc-api";

export function LogsView() {
  const logs = useQuery({ queryKey: ["noc", "logs"], queryFn: getNocLogs, refetchInterval: 30_000 });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4" />Recent router logs</CardTitle>
        {logs.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {logs.data && logs.data.logs.length === 0 && <p className="text-sm text-muted-foreground">No recent log entries across active routers.</p>}
        <div className="space-y-1.5">
          {logs.data?.logs.map((l, i) => (
            <div key={i} className="flex items-start gap-2 border-b border-border pb-1.5 text-xs last:border-0">
              <Badge variant="outline" className="shrink-0 text-[10px]">{l.routerName}</Badge>
              <span className="shrink-0 text-muted-foreground">{String(l.time)}</span>
              <span className="flex-1">{String(l.message)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
