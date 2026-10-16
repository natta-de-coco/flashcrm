import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Inbox,
  Mail,
  MessageCircle,
  Package,
  Plug,
  Receipt,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { canOpen } from "@/lib/permissions";
import { homeActionsFor, type HomeAction } from "@/lib/home-guide";
import type { MessageKey } from "@/lib/i18n";

const ICONS: Record<HomeAction["id"], LucideIcon> = {
  inbox: Inbox,
  contacts: Users,
  sales: Receipt,
  products: Package,
  social: MessageCircle,
  articles: FileText,
  content: BookOpen,
};
/** Decorative, code-native artwork: no fake business metrics, remote assets or text to translate. */
export function HomeIllustration() {
  return (
    <div className="home-illustration" aria-hidden="true">
      <div className="home-orbit" />
      <div className="home-art-person">
        <Users size={38} strokeWidth={1.6} />
      </div>
      <div className="home-art-message">
        <span>
          <MessageCircle size={20} />
          <Check size={16} />
        </span>
        <i />
        <i />
      </div>
      <div className="home-art-document">
        <Receipt size={24} />
        <i />
        <i />
        <i />
      </div>
      <span className="home-art-spark">
        <Sparkles size={23} />
      </span>
    </div>
  );
}

export function HomeStartGuide({
  role,
  expanded,
}: {
  role: string | null | undefined;
  expanded: boolean;
}) {
  const { t } = useI18n();
  const steps = [
    ...(canOpen(role, "/connect")
      ? ([{ id: "connect", to: "/connect", icon: Plug }] as const)
      : []),
    ...(canOpen(role, "/contacts")
      ? ([{ id: "contacts", to: "/contacts", icon: Users }] as const)
      : []),
    ...(canOpen(role, "/inbox") ? ([{ id: "reply", to: "/inbox", icon: Inbox }] as const) : []),
  ];
  if (!steps.length) return null;
  return (
    <details className="home-start rounded-2xl border bg-card" open={expanded}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
        <span className="home-icon-tile">
          <Sparkles className="size-5" />
        </span>
        <span className="flex-1 text-sm font-semibold sm:text-base">{t("home.start.title")}</span>
        <ChevronDown className="home-disclosure size-4 shrink-0 text-muted-foreground" />
      </summary>
      <div className="px-4 pb-5 sm:px-5">
        <p className="mb-4 text-sm text-muted-foreground">{t("home.start.note")}</p>
        <ol className="grid gap-3 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.id}>
              <Link
                to={step.to}
                className="home-step group flex h-full gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {t(`home.step.${step.id}.title` as MessageKey)}
                  </span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                    {t(`home.step.${step.id}.desc` as MessageKey)}
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <step.icon className="size-3.5" />
                    {t(`home.action.${step.id === "reply" ? "inbox" : step.id}` as MessageKey)}
                    <ArrowUpRight className="size-3.5 rtl:-rotate-90" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
        {!canOpen(role, "/connect") && (
          <p className="mt-3 text-xs text-muted-foreground">{t("home.help.manager")}</p>
        )}
      </div>
    </details>
  );
}

export function HomeTaskCards({ role }: { role: string | null | undefined }) {
  const { t } = useI18n();
  const actions = homeActionsFor(role);
  if (!actions.length) return null;
  return (
    <section aria-labelledby="home-tasks-heading">
      <h2 id="home-tasks-heading" className="text-lg font-semibold">
        {t("home.task.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("home.task.subtitle")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map((action, index) => {
          const Icon = ICONS[action.id];
          return (
            <Link
              key={action.id}
              to={action.to}
              {...(action.id === "social" ? { search: { tab: "write" as const } } : {})}
              className="home-task group flex gap-3 rounded-2xl border bg-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
              data-tone={index % 3}
            >
              <span className="home-icon-tile">
                <Icon className="size-5" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2 text-sm font-semibold">
                  {t(`home.action.${action.id}` as MessageKey)}
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground rtl:-rotate-90" />
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                  {t(`home.task.${action.id}` as MessageKey)}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function HomeGlossary({ role }: { role: string | null | undefined }) {
  const { t } = useI18n();
  const items = [
    { id: "inbox", to: "/inbox", icon: Mail },
    { id: "contacts", to: "/contacts", icon: Users },
    { id: "connect", to: "/connect", icon: Plug },
  ].filter((item) => canOpen(role, item.to));
  if (!items.length) return null;
  return (
    <details className="rounded-2xl border border-dashed bg-card/60">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl p-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <BookOpen className="size-4 text-primary" />
        <span className="flex-1">{t("home.glossary.title")}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </summary>
      <dl className="grid gap-4 px-4 pb-5 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.id}>
            <dt className="flex items-center gap-2 text-sm font-semibold">
              <item.icon className="size-4 text-primary" />
              {t(`home.glossary.${item.id}.title` as MessageKey)}
            </dt>
            <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t(`home.glossary.${item.id}.desc` as MessageKey)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
