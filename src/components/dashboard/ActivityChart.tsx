// The dashboard's 7-day activity chart, split into its own file so it can be
// lazy-loaded. recharts is most of the dashboard's JavaScript; with the chart
// imported directly, the stat cards and lists waited for it on every visit.
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

const activityConfig = {
  received: { label: "Received", color: "var(--color-chart-1)" },
  sent: { label: "Sent by you & AI", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

export default function ActivityChart({ buckets }: { buckets: readonly object[] }) {
  return (
    <ChartContainer config={activityConfig} className="h-56 w-full aspect-auto">
      <BarChart data={[...buckets]} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="received" stackId="msgs" fill="var(--color-received)" />
        <Bar dataKey="sent" stackId="msgs" fill="var(--color-sent)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
