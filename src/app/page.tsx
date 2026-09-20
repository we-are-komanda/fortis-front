"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Shield, Layers, ArrowRight, ChevronRight, Sun, Moon } from "lucide-react";
import { calculationLimitation, productCapabilities } from "@/shared/config/product-capabilities";
import { DemoRequestForm } from "@/modules/home/ui/demo-request-form";

// ─── Theme toggle ─────────────────────────────────────────────────────────────

function HeroThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="h-11 w-11 rounded-lg border border-white/12 dark:border-white/12 bg-white/8 hover:bg-white/14 dark:bg-white/5 dark:hover:bg-white/10 grid place-items-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer"
      aria-label="Переключить тему"
    >
      <Sun className="h-4 w-4 block dark:hidden" />
      <Moon className="h-4 w-4 hidden dark:block" />
    </button>
  );
}

// ─── Animation helpers ────────────────────────────────────────────────────────

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    // if already in viewport (e.g. bfcache restore), fire immediately
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setInView(true);
      obs.disconnect();
    }
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

// ─── Radar grid background ────────────────────────────────────────────────────

function RadarGrid({ dark }: { dark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let angle = 0;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const dots: { x: number; y: number; age: number; alpha: number }[] = [];
    const accent = dark ? "56,189,248" : "3,105,161";
    const accentLine = dark ? "rgba(56,189,248,0.55)" : "rgba(3,105,161,0.4)";

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height * 0.42;
      const maxR = Math.min(width, height) * 0.44;

      ctx.strokeStyle = `rgba(${accent},0.07)`;
      ctx.lineWidth = 1;
      for (let r = maxR / 4; r <= maxR; r += maxR / 4) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = `rgba(${accent},0.05)`;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
        ctx.stroke();
      }

      const sweepEnd = angle;
      const sweepStart = sweepEnd - 0.9;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      grad.addColorStop(0, `rgba(${accent},0.15)`);
      grad.addColorStop(1, `rgba(${accent},0)`);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, sweepStart, sweepEnd);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = accentLine;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweepEnd) * maxR, cy + Math.sin(sweepEnd) * maxR);
      ctx.stroke();

      if (Math.random() < 0.04) {
        const r = maxR * (0.3 + Math.random() * 0.65);
        const a = sweepEnd + (Math.random() - 0.5) * 0.3;
        dots.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, age: 0, alpha: 1 });
      }

      for (let i = dots.length - 1; i >= 0; i--) {
        const d = dots[i];
        d.age++;
        d.alpha = Math.max(0, 1 - d.age / 90);
        if (d.alpha <= 0) { dots.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(d.x, d.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent},${d.alpha * 0.9})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(d.x, d.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent},${d.alpha * 0.15})`;
        ctx.fill();
      }

      angle += 0.012;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [dark]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

// ─── Pill badge ───────────────────────────────────────────────────────────────

function Pill({ children, color = "sky" }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    sky:     "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    violet:  "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
    amber:   "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    indigo:  "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-widest ${colors[color] ?? colors.sky}`}>
      {children}
    </span>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({ icon, title, description, delay = 0, inView }: {
  icon: React.ReactNode; title: string; description: string; delay?: number; inView: boolean;
}) {
  return (
    <div
      className="group relative rounded-2xl border border-slate-200/60 dark:border-white/8 bg-white/70 dark:bg-white/4 p-6 backdrop-blur-sm transition-all duration-500 hover:border-sky-400/50 dark:hover:border-sky-500/30 hover:shadow-lg hover:shadow-sky-500/5"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms, border-color 0.3s, box-shadow 0.3s`,
      }}
    >
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-linear-to-br from-sky-500/4 to-transparent pointer-events-none" />
      <div className="mb-4 h-11 w-11 rounded-xl bg-sky-500/10 border border-sky-500/20 dark:border-sky-500/20 grid place-items-center text-sky-600 dark:text-sky-400 group-hover:bg-sky-500/16 transition-all duration-300">
        {icon}
      </div>
      <h3 className="mb-2 text-[15px] font-semibold text-slate-900 dark:text-white leading-snug">{title}</h3>
      <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Step card ────────────────────────────────────────────────────────────────

function StepCard({ num, title, description, delay, inView }: {
  num: string; title: string; description: string; delay: number; inView: boolean;
}) {
  return (
    <div
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 0.55s ease ${delay}ms, transform 0.55s ease ${delay}ms`,
      }}
    >
      <div className="text-[11px] font-bold tracking-widest text-sky-500 mb-3 uppercase">{num}</div>
      <h3 className="text-[17px] font-bold text-slate-900 dark:text-white mb-2 leading-snug">{title}</h3>
      <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HeroPage() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  const [heroRef, heroInView] = useInView(0.1);
  const [featuresRef, featuresInView] = useInView(0.1);
  const [howRef, howInView] = useInView(0.15);
  const [ctaRef, ctaInView] = useInView(0.2);

  const [showFloatingCta, setShowFloatingCta] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const heroCta = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = heroCta.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setShowFloatingCta(!entry.isIntersecting),
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#080d1a] text-slate-900 dark:text-white overflow-x-hidden font-sans transition-colors duration-300">

      {/* ─ Scroll to top ────────────────────────────────────────────────── */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Наверх"
        tabIndex={showScrollTop ? 0 : -1}
        aria-hidden={!showScrollTop}
        className="fixed right-5 bottom-6 z-40 h-10 w-10 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-white/10 shadow-lg shadow-slate-200/60 dark:shadow-black/30 grid place-items-center text-slate-500 dark:text-slate-400 hover:text-sky-500 dark:hover:text-sky-400 hover:border-sky-400/40 transition-all duration-200 cursor-pointer"
        style={{
          opacity: showScrollTop ? 1 : 0,
          transform: showScrollTop ? "translateY(0)" : "translateY(12px)",
          transition: "opacity 0.25s ease, transform 0.25s ease",
          pointerEvents: showScrollTop ? "auto" : "none",
        }}
      >
        <ChevronRight className="h-4 w-4 -rotate-90" />
      </button>

      {/* ─ Floating CTA ─────────────────────────────────────────────────── */}
      <div
        className="hidden md:block fixed right-5 top-1/2 -translate-y-1/2 z-40"
        inert={!showFloatingCta}
        aria-hidden={!showFloatingCta}
        style={{
          opacity: showFloatingCta ? 1 : 0,
          transform: showFloatingCta ? "translateY(-50%) translateX(0)" : "translateY(-50%) translateX(calc(100% + 20px))",
          transition: "opacity 0.35s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)",
          pointerEvents: showFloatingCta ? "auto" : "none",
        }}
      >
        <a
          href="#cta"
          className="group flex flex-col items-center gap-2 rounded-2xl px-4 py-4 bg-sky-500 hover:bg-sky-400 shadow-lg shadow-sky-500/30 hover:shadow-sky-500/50 transition-all duration-200 cursor-pointer"
        >
          <ArrowRight className="h-4 w-4 text-white group-hover:translate-x-0.5 transition-transform duration-200" />
          {/* вертикальный текст */}
          <span
            className="text-[11px] font-bold text-white uppercase tracking-widest leading-none"
            style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
          >
            Запросить демонстрацию
          </span>
        </a>
      </div>

      {/* ─ Nav ──────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-4 md:px-12 h-16 border-b border-slate-200/80 dark:border-white/6 bg-slate-50/85 dark:bg-[#080d1a]/85 backdrop-blur-xl transition-colors duration-300">
        <div className="flex items-center gap-2.5">
          <div className="h-11 w-11 rounded-lg bg-sky-500/12 border border-sky-500/25 grid place-items-center">
            <Shield className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          </div>
          <span className="font-display font-bold text-[17px] text-slate-900 dark:text-white tracking-tight">Fortis</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-[13px] text-slate-500 dark:text-slate-400">
          <a href="#features" className="hover:text-slate-900 dark:hover:text-white transition-colors">Возможности</a>
          <a href="#how"      className="hover:text-slate-900 dark:hover:text-white transition-colors">Как работает</a>
        </div>
        <div className="flex items-center gap-2">
          <HeroThemeToggle />
          <a
            href="/workspace"
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 min-h-11 px-3 py-2 text-xs sm:text-[13px] font-semibold text-white transition-colors shadow-sm shadow-sky-500/20"
          >
            Войти в рабочую зону
            <ChevronRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </nav>

      {/* ─ Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-20 pb-24 text-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-[-15%] left-1/2 -translate-x-1/2 h-175 w-175 rounded-full bg-sky-500/6 dark:bg-sky-500/8 blur-[120px]" />
          <div className="absolute bottom-[-10%] left-[-10%] h-100 w-100 rounded-full bg-indigo-600/5 dark:bg-indigo-600/8 blur-[100px]" />
          <div className="absolute bottom-[-5%] right-[-5%] h-87.5 w-87.5 rounded-full bg-sky-400/4 dark:bg-sky-400/6 blur-[90px]" />
        </div>

        <RadarGrid dark={dark} />

        <div ref={heroRef} className="relative z-10 flex flex-col items-center gap-6 max-w-3xl">
          <div style={{ opacity: heroInView ? 1 : 0, transform: heroInView ? "translateY(0)" : "translateY(16px)", transition: "opacity 0.6s ease, transform 0.6s ease" }}>
            <Pill color="sky">
              <Layers className="h-3 w-3" />
              Проекты и конфигурации
            </Pill>
          </div>

          <div style={{ opacity: heroInView ? 1 : 0, transform: heroInView ? "translateY(0)" : "translateY(20px)", transition: "opacity 0.7s ease 100ms, transform 0.7s ease 100ms" }}>
            <h1 className="font-display text-[44px] md:text-[64px] font-bold leading-[1.08] tracking-tight text-slate-900 dark:text-white">
              Планирование конфигураций и бюджета{" "}
              <span className="bg-linear-to-r from-sky-500 via-sky-400 to-indigo-500 dark:from-sky-400 dark:via-sky-300 dark:to-indigo-400 bg-clip-text text-transparent">
                 безопасности объекта
              </span>
            </h1>
          </div>

          <p
            className="max-w-xl text-[16px] text-slate-500 dark:text-slate-400 leading-relaxed"
            style={{ opacity: heroInView ? 1 : 0, transform: heroInView ? "translateY(0)" : "translateY(18px)", transition: "opacity 0.7s ease 200ms, transform 0.7s ease 200ms" }}
          >
            Соберите конфигурацию на карте, сравните сохранённые варианты и подготовьте отчёт для согласования
          </p>

          <div
            ref={heroCta}
            className="flex flex-wrap items-center justify-center gap-3 mt-2"
            style={{ opacity: heroInView ? 1 : 0, transform: heroInView ? "translateY(0)" : "translateY(16px)", transition: "opacity 0.7s ease 300ms, transform 0.7s ease 300ms" }}
          >
            <a
              href="/workspace"
              className="flex items-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 px-6 py-3 text-[14px] font-semibold text-white transition-all duration-200 shadow-lg shadow-sky-500/25 hover:shadow-sky-500/40"
            >
              Войти в рабочую зону
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#cta"
              className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/12 bg-white/80 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/9 px-6 py-3 text-[14px] font-medium text-slate-700 dark:text-slate-300 transition-all duration-200"
            >
              Запросить демонстрацию
            </a>
          </div>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">{calculationLimitation}</p>

        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-25">
          <div className="h-8 w-5 rounded-full border border-slate-400 dark:border-slate-600 flex items-start justify-center pt-1.5">
            <div className="h-1.5 w-1 rounded-full bg-slate-400 animate-bounce" />
          </div>
        </div>
      </section>

      {/* ─ Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="relative py-24 px-6">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-150 w-200 rounded-full bg-sky-500/4 dark:bg-sky-500/5 blur-[120px]" />
        </div>

        <div className="max-w-5xl mx-auto relative">
          <div ref={featuresRef}>
            <div
              className="mb-14 text-center"
              style={{ opacity: featuresInView ? 1 : 0, transform: featuresInView ? "translateY(0)" : "translateY(20px)", transition: "opacity 0.6s ease, transform 0.6s ease" }}
            >
              <Pill color="violet">
                <Layers className="h-3 w-3" />
                Возможности платформы
              </Pill>
              <h2 className="font-display mt-4 text-[34px] md:text-[42px] font-bold text-slate-900 dark:text-white leading-tight tracking-tight">
                Рабочий процесс
                <br />
                <span className="text-slate-400 dark:text-slate-400 font-medium text-[28px] md:text-[32px]">и границы текущего релиза</span>
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(["map", "ownData", "versions", "calculation", "compare", "report"] as const).map((key, index) => {
                const capability = productCapabilities[key];
                return <FeatureCard key={key} inView={featuresInView} delay={index * 70} icon={<Layers className="h-5 w-5" />} title={capability.title}
                  description={`${capability.description}${capability.status === "not_released" ? " Не включено в текущий релиз." : ""}`} />;
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="relative py-20 px-6 border-y border-slate-200/60 dark:border-white/5">
        <div className="max-w-5xl mx-auto" ref={howRef}>
          <h2 className="font-display text-3xl font-bold text-slate-900 dark:text-white">От исходных данных к проекту</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            <StepCard num="01" title="Выберите предприятие" description="В рабочей зоне отображаются предприятия, к которым вам предоставлен доступ." delay={0} inView={howInView} />
            <StepCard num="02" title="Соберите конфигурацию" description="Укажите исходные данные объекта и разместите средства защиты на карте." delay={100} inView={howInView} />
            <StepCard num="03" title="Сохраните вариант" description="Сохраните проект, чтобы вернуться к нему и продолжить работу." delay={200} inView={howInView} />
          </div>
        </div>
      </section>

      {/* ─ CTA ──────────────────────────────────────────────────────────── */}
      <section id="cta" className="relative py-28 px-6 overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-150 w-150 rounded-full bg-sky-500/6 dark:bg-sky-500/8 blur-[100px]" />
        </div>

        <div className="max-w-2xl mx-auto text-center relative" ref={ctaRef}>
          <div style={{ opacity: ctaInView ? 1 : 0, transform: ctaInView ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
            <Pill color="sky">Демонстрация Fortis</Pill>
            <h2 className="font-display mt-5 text-[36px] md:text-[48px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">Запросить демонстрацию</h2>
            <DemoRequestForm />
          </div>
        </div>
      </section>

      {/* ─ Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200/60 dark:border-white/5 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-sky-500/12 border border-sky-500/20 grid place-items-center">
              <Shield className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" />
            </div>
            <span className="font-display font-bold text-[15px] text-slate-900 dark:text-white">Fortis</span>
          </div>
          <div className="text-[12px] text-slate-400">
            © 2026 Fortis. Планирование конфигураций безопасности объекта.
          </div>
          <Link href="/workspace" className="text-[12px] text-sky-500 hover:text-sky-400 transition-colors">
            Войти в рабочую зону →
          </Link>
        </div>
      </footer>
    </div>
  );
}
