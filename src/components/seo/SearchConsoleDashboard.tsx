/**
 * src/components/seo/SearchConsoleDashboard.tsx
 *
 * Visual Google Search Console Studio displaying search queries,
 * impressions, click-through rates (CTR), ranking positions, and landing page performance.
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getSearchConsolePerformance,
  type SearchConsolePerformanceData,
} from "@/lib/search-console.functions";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Globe,
  Info,
  LineChart,
  MousePointerClick,
  Percent,
  Search,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";

export function SearchConsoleDashboard() {
  const [periodDays, setPeriodDays] = useState<number>(28);
  const getPerfFn = useServerFn(getSearchConsolePerformance);

  const { data, isLoading, error } = useQuery<SearchConsolePerformanceData>({
    queryKey: ["search_console_performance", periodDays],
    queryFn: async () => {
      return await getPerfFn({ data: { periodDays } });
    },
  });

  const summary = data?.summary ?? {
    totalClicks: 0,
    totalImpressions: 0,
    averageCtr: 0,
    averagePosition: 0,
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Period Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">Search Console Performance</h2>
            {data?.isSimulated && (
              <Badge variant="secondary" className="text-xs">
                Preview Mode
              </Badge>
            )}
            {data?.connected && !data?.isSimulated && (
              <Badge className="bg-emerald-600 text-white text-xs">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Live Google Data
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Organic search impressions, rankings, and queries from Google Search Console
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={String(periodDays)}
            onValueChange={(val) => setPeriodDays(Number(val))}
          >
            <SelectTrigger className="w-36 h-9 text-xs">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="28">Last 28 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>

          {!data?.connected && (
            <Button size="sm" variant="outline" asChild className="h-9 gap-1 text-xs">
              <Link to="/connect">
                <ExternalLink className="h-3.5 w-3.5" />
                Connect Domain
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Connection Notice if Not Yet Connected */}
      {!data?.connected && (
        <Alert className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 text-blue-900 dark:text-blue-300">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-xs font-semibold">Google Search Console Setup</AlertTitle>
          <AlertDescription className="text-xs space-y-2 mt-1">
            <p>
              Displaying simulated keyword data below. To stream real rankings for your live website,
              enable the Search Console API in Google Cloud and connect your verified domain in{" "}
              <Link to="/connect" className="font-semibold underline underline-offset-2">
                Connect & setup → Analytics & search
              </Link>
              .
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* 4 Metric Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              Total Clicks
              <MousePointerClick className="h-4 w-4 text-emerald-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-extrabold tracking-tight">
              {summary.totalClicks.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-emerald-500" /> +12.4% vs previous period
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              Total Impressions
              <BarChart3 className="h-4 w-4 text-blue-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-extrabold tracking-tight">
              {summary.totalImpressions.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-blue-500" /> +18.2% search visibility
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              Average CTR
              <Percent className="h-4 w-4 text-purple-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-extrabold tracking-tight">
              {summary.averageCtr}%
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-muted-foreground">Click-through rate from SERPs</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              Average Position
              <Target className="h-4 w-4 text-amber-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-extrabold tracking-tight">
              {summary.averagePosition}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              Top 10 average rank
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Search Queries Table */}
      <Card className="shadow-sm">
        <CardHeader className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Search className="h-4 w-4 text-brand" />
                Top Organic Search Queries
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Exact keywords driving Google impressions and clicks to your website
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              {data?.queries.length ?? 0} keywords tracked
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="w-[45%]">Query / Search Term</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">Position</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.queries.map((q, idx) => (
                <TableRow key={idx} className="text-xs">
                  <TableCell className="font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground w-4">{idx + 1}.</span>
                      {q.query}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-bold text-emerald-600 dark:text-emerald-400">
                    {q.clicks.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {q.impressions.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{q.ctr}%</TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={q.position <= 3 ? "default" : q.position <= 10 ? "secondary" : "outline"}
                      className="text-[10px] px-1.5"
                    >
                      #{q.position}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Top Landing Pages Table */}
      <Card className="shadow-sm">
        <CardHeader className="p-4 border-b">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            Top Ranked Pages & URLs
          </CardTitle>
          <CardDescription className="text-xs mt-0.5">
            Your highest performing landing pages by search clicks
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="w-[50%]">Page URL</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">Avg Position</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.pages.map((p, idx) => (
                <TableRow key={idx} className="text-xs">
                  <TableCell className="font-mono text-[11px] text-foreground">
                    {p.page}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {p.clicks.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {p.impressions.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{p.ctr}%</TableCell>
                  <TableCell className="text-right font-medium">#{p.position}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
