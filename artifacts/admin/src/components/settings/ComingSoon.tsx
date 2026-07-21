import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function ComingSoon({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="pt-6 flex gap-3">
        <Construction className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium">Not available yet</p>
          <p className="text-xs text-muted-foreground mt-1">{message}</p>
        </div>
      </CardContent>
    </Card>
  );
}
