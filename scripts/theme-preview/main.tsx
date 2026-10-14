import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppFrame } from "@/components/AppFrame";
import { AppearanceMenu } from "@/components/AppearanceMenu";
import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { NAV_SECTIONS } from "@/lib/navigation";
import { translate, navMessageKey } from "@/lib/i18n";
import {
  Menu,
  PanelLeft,
  Search,
  Plus,
  Sparkles,
  ArrowUpRight,
  Inbox,
  Users,
  MessageSquare,
  Bot,
  Send,
  RefreshCw,
  LogOut,
} from "lucide-react";
import "./styles.css";

function Preview() {
  const [collapsed, setCollapsed] = useState(false);
  const [page, setPage] = useState("/dashboard");
  const [arabic, setArabic] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState("");
  const language = arabic ? "ar" : "en";
  const items = NAV_SECTIONS.flatMap((s) => s.items);
  const title = translate(language, navMessageKey(page, "label"));
  const label = (en: string, ar: string) => (arabic ? ar : en);
  function toggleLanguage() {
    document.documentElement.dir = arabic ? "ltr" : "rtl";
    document.documentElement.lang = arabic ? "en" : "ar";
    setArabic(!arabic);
  }
  const nav = (
    <>
      <div className="mx-3 flex min-h-16 items-center gap-3 px-2">
        <FlashLogoBadge className="size-10 shrink-0" />
        <span className="crm-workspace-label min-w-0">
          <span className="block text-sm font-semibold">Flas CRM</span>
          <span className="block truncate text-xs text-muted-foreground">
            {label("Demo workspace", "مساحة عمل تجريبية")}
          </span>
        </span>
      </div>
      <nav className="flash-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-3">
        {NAV_SECTIONS.filter((s) => s.id !== "platform").map((section) => (
          <div className="crm-nav-section" key={section.id}>
            <p className="crm-nav-heading mb-2 px-3 text-xs font-medium text-muted-foreground">
              {translate(language, `nav.section.${section.id}`)}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <button
                  key={item.to}
                  onClick={() => {
                    setPage(item.to);
                    setDrawer(false);
                  }}
                  title={translate(language, navMessageKey(item.to, "label"))}
                  aria-current={page === item.to ? "page" : undefined}
                  className="crm-nav-link flex min-h-10 w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-start text-muted-foreground hover:bg-sidebar-accent"
                >
                  <item.icon className="size-[18px] shrink-0" />
                  <span className="crm-nav-label truncate text-sm font-medium">
                    {translate(language, navMessageKey(item.to, "label"))}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="m-3 rounded-xl border bg-background p-2">
        <p className="crm-workspace-label truncate px-2 py-1 text-xs text-muted-foreground">
          demo@example.test
        </p>
        <Button variant="ghost" className="w-full justify-start" disabled>
          <LogOut />
          <span className="crm-workspace-label">{label("Preview only", "معاينة فقط")}</span>
        </Button>
      </div>
    </>
  );
  return (
    <AppFrame
      collapsed={collapsed}
      sidebar={nav}
      header={
        <>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:flex"
            aria-label="Toggle sidebar"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            onClick={() => setDrawer(!drawer)}
          >
            <Menu />
          </Button>
          <span className="hidden h-5 w-px bg-border sm:block" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
          <Button
            variant="outline"
            className="ms-auto hidden w-48 justify-start text-muted-foreground sm:flex"
          >
            <Search />
            {label("Search Flas…", "ابحث في Flas…")}
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleLanguage}>
            {arabic ? "English" : "العربية"}
          </Button>
          <AppearanceMenu />
          <Button className="rounded-full">
            <Plus />
            <span className="hidden sm:inline">{label("Create", "إنشاء")}</span>
          </Button>
        </>
      }
      mobileNav={
        <nav className="flex border-t lg:hidden">
          {items
            .filter((i) => ["/dashboard", "/inbox", "/contacts", "/social"].includes(i.to))
            .map((item) => (
              <button
                key={item.to}
                onClick={() => setPage(item.to)}
                className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px]"
              >
                <item.icon className="size-4" />
                {translate(language, navMessageKey(item.to, "label"))}
              </button>
            ))}
        </nav>
      }
    >
      {drawer && (
        <div className="absolute inset-y-14 start-0 z-40 flex w-72 flex-col border bg-sidebar shadow-xl lg:hidden">
          {nav}
        </div>
      )}
      <div className="border-b bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
        {label(
          "Design preview · sample data · no live connections or sends",
          "معاينة التصميم · بيانات تجريبية · لا اتصالات أو إرسال فعلي",
        )}
      </div>
      <main className="min-h-0 flex-1 p-4 sm:p-6">
        <PageHeader
          title={title}
          description={translate(language, navMessageKey(page, "desc"))}
          actions={
            <Button variant="outline">
              <RefreshCw />
              {label("Refresh", "تحديث")}
            </Button>
          }
        />
        {page === "/dashboard" ? (
          <>
            <div className="crm-brief mb-5 rounded-2xl border p-5 sm:p-8">
              <Badge variant="outline" className="mb-4 gap-2">
                <Sparkles className="size-3.5" />
                {label("Your workspace at a glance", "نظرة عامة على مساحة عملك")}
              </Badge>
              <h2 className="text-2xl font-semibold sm:text-3xl">
                {label("Welcome back to Flas", "مرحبًا بعودتك إلى Flas")}
              </h2>
              <p className="mt-3 max-w-2xl text-muted-foreground">
                {label(
                  "Conversations, customers and growth. A calmer place to keep everything moving.",
                  "المحادثات والعملاء والنمو. مكان أوضح لمتابعة أعمالك.",
                )}
              </p>
              <div className="mt-6 flex flex-wrap gap-8">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {label("Waiting for a reply", "بانتظار الرد")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">12</p>
                </div>
                <div className="border-s ps-8">
                  <p className="text-xs text-muted-foreground">
                    {label("New contacts", "جهات اتصال جديدة")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">38</p>
                </div>
                <div className="border-s ps-8">
                  <p className="text-xs text-muted-foreground">
                    {label("Active conversations", "محادثات نشطة")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">124</p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [Inbox, "Open conversations", "محادثات مفتوحة", 124],
                [Users, "Contacts", "جهات الاتصال", 384],
                [MessageSquare, "Messages today", "رسائل اليوم", 76],
                [Bot, "Assistant replies", "ردود المساعد", 28],
              ].map(([Icon, en, ar, value]) => (
                <Card key={String(en)}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
                        <Icon className="size-5" />
                      </span>
                      <Badge variant="secondary" className="text-brand">
                        <ArrowUpRight className="me-1 size-3" />
                        12%
                      </Badge>
                    </div>
                    <p className="mt-5 text-sm text-muted-foreground">
                      {label(String(en), String(ar))}
                    </p>
                    <p className="stat-figure mt-2 text-3xl font-semibold">{String(value)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>{label("Conversation activity", "نشاط المحادثات")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex h-44 items-end gap-4 border-b px-4">
                    {[48, 70, 55, 86, 65, 92, 75].map((height, i) => (
                      <div key={i} className="flex flex-1 items-end gap-1">
                        <div
                          className="w-1/2 rounded-t-sm bg-brand"
                          style={{ height: height * 1.6 }}
                        />
                        <div
                          className="w-1/2 rounded-t-sm bg-chart-2/70"
                          style={{ height: height }}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">
                    {label("Sample activity across seven days", "نشاط تجريبي خلال سبعة أيام")}
                  </p>
                </CardContent>
              </Card>
              <Card className="crm-brief">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="size-4 text-brand" />
                    {label("Daily brief", "الملخص اليومي")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {label(
                      "Your existing AI briefing, health scores and retry states remain connected in the real CRM.",
                      "تبقى ملخصات الذكاء الاصطناعي ومؤشرات الصحة وحالات إعادة المحاولة مرتبطة في التطبيق الحقيقي.",
                    )}
                  </p>
                  <Button className="mt-5" onClick={() => setPage("/inbox")}>
                    {label("Open inbox", "فتح صندوق الوارد")}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </>
        ) : page === "/inbox" ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {label("WhatsApp · Demo contact", "واتساب · جهة اتصال تجريبية")}
              </CardTitle>
              <p className="text-xs text-muted-foreground" dir="ltr">
                +971 50 000 0000
              </p>
            </CardHeader>
            <CardContent>
              <div className="chat-canvas-bg flex min-h-64 flex-col gap-4 rounded-xl p-5">
                <p className="max-w-xs self-start rounded-2xl bg-bubble-in p-4 text-bubble-in-foreground">
                  {label(
                    "Hi, could you share your product catalogue?",
                    "مرحبًا، هل يمكن مشاركة كتالوج المنتجات؟",
                  )}
                </p>
                <p className="max-w-xs self-end rounded-2xl bg-bubble-out p-4 text-bubble-out-foreground">
                  {label(
                    "Of course. What products are you looking for?",
                    "بالتأكيد. ما المنتجات التي تبحث عنها؟",
                  )}
                </p>
              </div>
              <Input
                aria-label="Preview reply"
                placeholder={label("Write a reply…", "اكتب ردًا…")}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="mt-4"
              />
              <div className="mt-3 flex justify-between gap-2">
                <Button variant="outline">
                  <Sparkles />
                  {label("Suggest reply", "اقتراح رد")}
                </Button>
                <Button disabled>
                  <Send />
                  {label("Send disabled in preview", "الإرسال معطّل في المعاينة")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : page === "/settings" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{label("Company identity", "هوية الشركة")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="block text-sm">
                  {label("Company name", "اسم الشركة")}
                  <Input className="mt-2" defaultValue="Demo workspace" />
                </label>
                <label className="block text-sm">
                  {label("Company logo", "شعار الشركة")}
                  <Input type="file" accept="image/*" className="mt-2" />
                </label>
                <p className="text-xs text-muted-foreground">
                  {label(
                    "The existing invoice logo and branding workflow is preserved.",
                    "تم الحفاظ على إعدادات شعار الفواتير والهوية البصرية الحالية.",
                  )}
                </p>
                <Button disabled>
                  {label("Save disabled in preview", "الحفظ معطّل في المعاينة")}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{label("Appearance", "المظهر")}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {label("Light, dark or your device setting", "فاتح أو داكن أو إعداد الجهاز")}
                </span>
                <AppearanceMenu />
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-2">
                <Input
                  aria-label="Search sample records"
                  className="max-w-sm"
                  placeholder={label("Search records…", "البحث في السجلات…")}
                />
                <Button variant="outline">{label("Filters", "تصفية")}</Button>
                <Badge variant="secondary">{label("Sample records", "سجلات تجريبية")}</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{label("Name", "الاسم")}</TableHead>
                    <TableHead>{label("Status", "الحالة")}</TableHead>
                    <TableHead>{label("Owner", "المسؤول")}</TableHead>
                    <TableHead>{label("Updated", "آخر تحديث")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {["Sample company A", "Sample company B", "Sample company C"].map((name, i) => (
                    <TableRow key={name}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>
                        <Badge variant={i === 1 ? "outline" : "secondary"}>
                          {label(i === 1 ? "Pending" : "Active", i === 1 ? "قيد الانتظار" : "نشط")}
                        </Badge>
                      </TableCell>
                      <TableCell>{label("Demo team", "الفريق التجريبي")}</TableCell>
                      <TableCell>{label("Today", "اليوم")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </main>
    </AppFrame>
  );
}
const previewRoot = createRoot(document.getElementById("root")!);
previewRoot.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => previewRoot.unmount());
