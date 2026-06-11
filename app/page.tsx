import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import { Suspense } from "react";

function HeroSection() {
  return (
    <section className="relative flex flex-col items-center text-center px-4 pt-24 pb-16">
      {/* Floating background logos */}
      <div className="pointer-events-none absolute left-4 top-16 hidden lg:block">
        <Logo size="sm" />
      </div>
      <div className="pointer-events-none absolute bottom-0 left-8 hidden xl:block">
        <Logo size="float" />
      </div>

      {/* Badge */}
      <div
        className="mb-6 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 font-mono text-xs"
        style={{
          borderColor: "rgba(0,200,150,0.25)",
          backgroundColor: "rgba(0,200,150,0.07)",
          color: "#00C896",
        }}
      >
        <span className="relative flex h-1.5 w-1.5 rounded-full bg-green">
          <span className="absolute inset-0 animate-ping rounded-full bg-green opacity-60" />
        </span>
        HTTP 0x0801 · LLM 0x0802 · Scheduler · TEE Verified
      </div>

      {/* H1 */}
      <h1 className="max-w-3xl text-5xl font-bold leading-tight tracking-tight text-white md:text-6xl lg:text-7xl">
        <span
          style={{
            backgroundImage: "linear-gradient(135deg, #818CF8 0%, #5B4FE8 50%, #3B82F6 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Autonomous
        </span>{" "}
        portfolio rebalancing on Ritual Chain.
      </h1>

      {/* Sub */}
      <p
        className="mt-6 max-w-xl text-base leading-7"
        style={{ color: "rgba(255,255,255,0.5)" }}
      >
        You set your target weights once. Rebal's onchain agent checks your portfolio every 16 minutes
        and rebalances when it drifts. No input needed after setup.
      </p>

      {/* CTAs */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/app"
          className="rounded-full px-7 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: "#5B4FE8" }}
        >
          Get Started
        </Link>
        <Link
          href="/app?tab=rebalance"
          className="rounded-full border px-7 py-3 text-sm font-semibold transition hover:bg-white/5"
          style={{
            borderColor: "rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.5)",
          }}
        >
          Set Allocation
        </Link>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: "01",
      title: "Set your targets",
      body: "Connect your wallet and pick how much goes into WETH, WBTC, USDC, and USDT. If you'd rather not think about percentages, just type what you want in plain English and the AI will handle the rest.",
    },
    {
      num: "02",
      title: "Agent watches 24/7",
      body: "An agent runs on Ritual Chain and checks your portfolio roughly every 16 minutes. It fetches live prices, spots drift, and reasons through what to do using Ritual's native LLM precompile inside a TEE.",
    },
    {
      num: "03",
      title: "Rebalances automatically",
      body: "When your portfolio drifts past your threshold the agent executes a swap through 1inch or Uniswap. It only acts when the profit beats the gas cost. Every trade is recorded onchain.",
    },
  ] as const;

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <p
        className="mb-10 text-center font-mono text-xs uppercase tracking-widest"
        style={{ color: "rgba(255,255,255,0.2)", letterSpacing: "2px" }}
      >
        How it works
      </p>
      <div className="grid gap-5 md:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.num}
            className="rounded-2xl border p-7"
            style={{
              backgroundColor: "rgba(255,255,255,0.025)",
              borderColor: "rgba(255,255,255,0.06)",
            }}
          >
            <p
              className="mb-3 font-mono text-lg font-bold"
              style={{ color: "#5B4FE8" }}
            >
              {s.num}
            </p>
            <h3 className="mb-3 text-base font-semibold text-white">{s.title}</h3>
            <p className="text-sm leading-6" style={{ color: "rgba(255,255,255,0.45)" }}>
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BottomCTA() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20">
      <div
        className="rounded-2xl p-8 md:p-12"
        style={{
          background:
            "linear-gradient(135deg, rgba(91,79,232,0.12) 0%, rgba(59,130,246,0.06) 100%)",
          border: "1px solid rgba(91,79,232,0.25)",
        }}
      >
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white md:text-3xl">
              Set it up once and walk away.
            </h2>
            <p
              className="mt-3 max-w-md text-sm leading-6"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              Connect your wallet, set your targets, and let the agent do the rest. Everything runs
              onchain on Ritual Chain.
            </p>
            <div
              className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs"
              style={{
                borderColor: "rgba(212,168,71,0.3)",
                color: "#D4A847",
                backgroundColor: "rgba(212,168,71,0.07)",
              }}
            >
              <span className="relative flex h-1.5 w-1.5 rounded-full bg-gold">
                <span className="absolute inset-0 animate-ping rounded-full bg-gold opacity-60" />
              </span>
              Powered by Ritual Chain · 1979
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Link
              href="/app"
              className="rounded-full px-7 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: "#5B4FE8" }}
            >
              Open App
            </Link>
            <Link
              href="/app?tab=rebalance"
              className="rounded-full border px-7 py-3 text-sm font-semibold transition hover:bg-white/5"
              style={{
                borderColor: "rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              Set Allocation
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main className="relative min-h-screen">
      <Suspense>
        <Nav variant="home" />
      </Suspense>
      <HeroSection />
      <HowItWorks />
      <BottomCTA />
    </main>
  );
}
