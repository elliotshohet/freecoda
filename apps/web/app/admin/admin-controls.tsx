"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function AdminControls({ days }: { days: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3" aria-busy={pending}>
      <ToggleGroup
        aria-label="Observation period"
        data-horizontal=""
        variant="outline"
        size="lg"
        spacing={0}
        value={[String(days)]}
        disabled={pending}
        onValueChange={values => {
          const next = values[0];
          if (next && next !== String(days)) startTransition(() => router.push(`/admin?days=${next}`, { scroll: false }));
        }}
      >
        {[7, 30, 90].map(period => <ToggleGroupItem key={period} value={String(period)} aria-label={`${period} days`}>{period} days</ToggleGroupItem>)}
      </ToggleGroup>
      <Button variant="outline" size="lg" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        <RefreshCw data-icon="inline-start" />{pending ? "Updating…" : "Refresh"}
      </Button>
      <span role="status" className="sr-only">{pending ? "Updating dashboard" : `Showing ${days} days`}</span>
    </div>
  );
}
