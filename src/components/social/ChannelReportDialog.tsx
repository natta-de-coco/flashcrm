// The report for one analytics or ads connection: the provider's own figures
// for the last 28 days. Formatted for reading, never recalculated -- a number
// on this screen is always one the platform reported.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getChannelReport } from "@/lib/social-doctor.functions";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3 } from "lucide-react";
import { useState } from "react";

/** Mirrors REPORT_PLATFORMS in reports.server.ts, which the browser cannot import. */
export const REPORT_PLATFORMS: ReadonlySet<string> = new Set([
  "google_analytics",
  "search_console",
  "meta_ads",
]);

type Report = Awaited<ReturnType<typeof getChannelReport>>;
type Format = Report["totals"][number]["format"];

function formatValue(value: number, format: Format, currency?: string): string {
  switch (format) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "decimal":
      return value.toFixed(1);
    case "currency":
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency ?? "USD",
        }).format(value);
      } catch {
        return value.toFixed(2);
      }
    default:
      return Math.round(value).toLocaleString();
  }
}

export function ChannelReportDialog({ accountId, label }: { accountId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const load = useServerFn(getChannelReport);
  const report = useQuery({
    queryKey: ["channel-report", accountId],
    queryFn: () => load({ data: { accountId } }),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const data = report.data;
  const currency = data?.totals.find((t) => t.currency)?.currency;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          aria-label={`Open the report for ${label}`}
        >
          <BarChart3 className="size-3.5" />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.from} to ${data.to}, from the platform's own reporting.`
              : "The last 28 days, from the platform's own reporting."}
          </DialogDescription>
        </DialogHeader>

        {report.isPending && (
          <div className="grid gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {report.isError && (
          <p className="text-sm text-destructive">{(report.error as Error).message}</p>
        )}

        {data && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.totals.map((m) => (
                <div key={m.key} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatValue(m.value, m.format, m.currency)}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">{data.table.title}</p>
              {data.table.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data for this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      {data.table.columns.map((c) => (
                        <TableHead key={c.key} className="text-right">
                          {c.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.table.rows.map((row, i) => (
                      <TableRow key={`${row.label}-${i}`}>
                        <TableCell className="max-w-[16rem] truncate">{row.label}</TableCell>
                        {data.table.columns.map((c) => (
                          <TableCell key={c.key} className="text-right tabular-nums">
                            {formatValue(row.values[c.key] ?? 0, c.format, currency)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {data.note && <p className="text-xs text-muted-foreground">{data.note}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
