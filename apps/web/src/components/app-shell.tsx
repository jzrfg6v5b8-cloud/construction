"use client";

import Link from "next/link";
import {
  Bell,
  Blocks,
  Box,
  FileImage,
  FileText,
  FolderKanban,
  Grid2X2,
  HelpCircle,
  Menu,
  Settings,
  Sparkles,
  Workflow,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLocale } from "@/lib/i18n/runtime";

export type ShellNavKey =
  | "project"
  | "assets"
  | "calibration"
  | "procurement"
  | "scene"
  | "proposal"
  | "sketchup";

type AppShellProps = {
  children: React.ReactNode;
  current: ShellNavKey;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  fullBleed?: boolean;
  projectId?: string;
  projectName?: string;
};

export function AppShell({
  children,
  current,
  title,
  description,
  actions,
  fullBleed = false,
  projectId = "demo",
  projectName,
}: AppShellProps) {
  const { messages } = useLocale();
  const shell = messages.shell;
  const base = `/projects/${projectId}`;
  const navigation = [
    { key: "project" as const, label: shell.project, href: "/projects", icon: FolderKanban },
    { key: "assets" as const, label: shell.assets, href: `${base}/assets`, icon: FileImage },
    { key: "calibration" as const, label: shell.calibration, href: `${base}/calibration`, icon: Grid2X2 },
    { key: "procurement" as const, label: shell.procurement, href: `${base}/procurement`, icon: Blocks },
    { key: "scene" as const, label: shell.scene, href: `${base}/scene-builder`, icon: Box },
    { key: "proposal" as const, label: shell.proposal, href: `${base}/proposal`, icon: FileText },
    { key: "sketchup" as const, label: shell.sketchup, href: `${base}/sketchup`, icon: Workflow },
  ];

  const currentLabel = navigation.find((item) => item.key === current)?.label ?? current;
  const displayName = projectName || shell.projectName;

  return (
    <div className="min-h-screen bg-[#f5f7f8] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-[#0b2230] text-white lg:flex">
        <div className="flex h-18 items-center gap-3 border-b border-white/10 px-6">
          <div className="grid size-9 place-items-center rounded-xl bg-teal-400 text-[#0b2230] shadow-lg shadow-teal-950/20">
            <Sparkles size={19} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-[15px] font-bold tracking-tight">{messages.common.brand}</p>
            <p className="text-[10px] font-medium tracking-[0.16em] text-slate-400">
              SPATIAL COMMERCE
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          <p className="px-3 pb-2 pt-4 text-[10px] font-semibold tracking-[0.18em] text-slate-500">
            {shell.workspace}
          </p>
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = current === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  active
                    ? "bg-white/10 font-semibold text-white shadow-sm"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon size={17} className={active ? "text-teal-300" : "text-slate-500"} />
                {item.label}
                {active && <span className="ml-auto size-1.5 rounded-full bg-teal-300" />}
              </Link>
            );
          })}
        </nav>
        <div className="m-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold">{displayName}</p>
          <p className="mt-2 truncate text-[11px] text-slate-400">ID · {projectId}</p>
          <Link
            href="/projects"
            className="mt-3 inline-flex text-[11px] font-semibold text-teal-300 hover:text-teal-200"
          >
            切换 / 新建项目 →
          </Link>
        </div>
        <div className="flex items-center gap-3 border-t border-white/10 p-4">
          <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-amber-200 to-orange-400 text-xs font-bold text-slate-900">
            {shell.designer.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{shell.designer}</p>
            <p className="truncate text-[10px] text-slate-400">{shell.plan}</p>
          </div>
          <Link href="/auth" aria-label={messages.common.signIn}>
            <Settings size={15} className="text-slate-500" />
          </Link>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-18 items-center border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-6">
          <button
            className="mr-3 grid size-9 place-items-center rounded-lg border border-slate-200 lg:hidden"
            aria-label={messages.common.openMenu}
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
              <Link href="/projects" className="hover:text-slate-700">
                {displayName}
              </Link>
              <span>/</span>
              <span className="text-slate-600">{currentLabel}</span>
            </div>
            <h1 className="truncate text-base font-bold tracking-tight sm:text-lg">{title}</h1>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher className="rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100" />
            <span className="hidden text-slate-200 sm:inline">|</span>
            <button
              className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label={messages.common.help}
            >
              <HelpCircle size={17} />
            </button>
            <button
              className="relative grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label={messages.common.notifications}
            >
              <Bell size={17} />
            </button>
          </div>
        </header>

        <main className={fullBleed ? "" : "p-4 sm:p-6 xl:p-8"}>
          {!fullBleed && (description || actions) && (
            <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <p className="max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
              <div className="flex flex-wrap items-center gap-2">{actions}</div>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
