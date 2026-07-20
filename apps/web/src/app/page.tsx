"use client";

import Link from "next/link";
import { ArrowRight, Box, CheckCircle2, FileSearch, Images, Layers3, Ruler, ShieldCheck, ShoppingCart, Sparkles } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLocale } from "@/lib/i18n/runtime";

const workflow = [
  { icon: Images, href: "/projects" },
  { icon: Ruler, href: "/projects" },
  { icon: ShoppingCart, href: "/projects" },
  { icon: Layers3, href: "/projects" },
];

export default function Home() {
  const { messages } = useLocale();
  const home = messages.home;

  return (
    <main className="min-h-screen bg-[#f3f1eb] text-[#17211d]">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3 font-semibold tracking-tight">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#123f35] text-white"><Box size={21} /></span>
          <span>Sharkflows <span className="font-normal text-[#718079]">Space Configurator</span></span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <LanguageSwitcher className="text-[#5c6963]" compact />
          <Link href="/pricing" className="hidden rounded-lg px-3 py-2 hover:bg-white sm:block">{messages.common.pricing}</Link>
          <Link href="/auth" className="rounded-lg border border-[#ced4cf] bg-white px-4 py-2">{messages.common.signIn}</Link>
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl gap-12 px-6 pb-16 pt-12 lg:grid-cols-[1.05fr_.95fr] lg:pt-20">
        <div>
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#9fb8ae] bg-[#e5eee9] px-3 py-1.5 text-xs font-medium text-[#245c4e]">
            <Sparkles size={14} /> {home.badge}
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-7xl">{home.title}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-[#5c6963]">
            {home.subtitle}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/projects" className="inline-flex items-center gap-2 rounded-xl bg-[#123f35] px-5 py-3 font-medium text-white shadow-lg shadow-[#123f35]/15">{home.openDemo} <ArrowRight size={17} /></Link>
            <Link href="/auth" className="inline-flex items-center gap-2 rounded-xl border border-[#cbd1cc] bg-white px-5 py-3 font-medium">{messages.common.signIn}</Link>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-sm text-[#63716a]">
            {home.assurances.map((item) => (
              <span key={item} className="flex items-center gap-2"><CheckCircle2 size={15} className="text-[#2a7a63]" />{item}</span>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/80 bg-[#193f35] p-5 shadow-2xl shadow-[#1d392f]/20">
          <div className="mb-5 flex items-center justify-between text-white">
            <div><p className="text-xs text-white/55">PROJECT 042</p><p className="mt-1 font-medium">{home.project}</p></div>
            <span className="rounded-full bg-[#ddae5c] px-3 py-1 text-xs font-semibold text-[#3b2b10]">{home.status}</span>
          </div>
          <div className="grid aspect-[5/4] grid-cols-2 grid-rows-2 gap-2 rounded-2xl bg-[#e8e4da] p-3">
            <Room name={home.rooms[0]} className="rounded-tl-xl bg-[#ded3bd]" objectClass="bottom-5 left-5 h-10 w-20 bg-[#8ea49a]" />
            <Room name={home.rooms[1]} className="rounded-tr-xl bg-[#e8ded1]" objectClass="inset-x-5 bottom-4 h-20 bg-[#9c856d]" />
            <Room name={home.rooms[2]} className="rounded-bl-xl bg-[#d7dfd8]" objectClass="bottom-4 left-4 top-10 w-7 bg-[#769088]" />
            <Room name={home.rooms[3]} className="rounded-br-xl bg-[#e4d7c7]" objectClass="inset-x-7 bottom-5 h-14 bg-[#ae947a]" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-white">
            {[["16", home.metrics[0]], ["94%", home.metrics[1]], ["3", home.metrics[2]]].map(([value, label]) => (
              <div key={label} className="rounded-xl bg-white/8 p-3"><p className="text-lg font-semibold">{value}</p><p className="text-xs text-white/50">{label}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[#d8d8d1] bg-[#faf9f6]">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-8 flex items-end justify-between">
            <div><p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-[#6c776f]">{home.workflowEyebrow}</p><h2 className="text-3xl font-semibold tracking-tight">{home.workflowTitle}</h2></div>
            <div className="hidden items-center gap-2 text-sm text-[#64716b] md:flex"><ShieldCheck size={17}/> {home.privacy}</div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflow.map(({ icon: Icon, href }, index) => {
              const [title, detail] = home.workflow[index];
              return (
              <Link href={href} key={title} className="group rounded-2xl border border-[#dddeda] bg-white p-5 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5">
                <div className="flex items-start justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e7eee9] text-[#215b4b]"><Icon size={19}/></span><span className="text-xs text-[#9aa29e]">0{index + 1}</span></div>
                <h3 className="mt-7 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#68736d]">{detail}</p>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-[#245f4f]">{home.enter} <ArrowRight size={14} className="transition group-hover:translate-x-1"/></span>
              </Link>
            )})}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-[#ead7ab] bg-[#fff8e8] px-4 py-3 text-sm text-[#72551c]">
            <FileSearch size={17}/> {home.notice}
          </div>
        </div>
      </section>
    </main>
  );
}

function Room({ name, className, objectClass }: { name: string; className: string; objectClass: string }) {
  return <div className={`relative border-2 border-[#2f3b36] p-3 ${className}`}><span className="text-xs font-semibold">{name}</span><div className={`absolute rounded ${objectClass}`} /></div>;
}
