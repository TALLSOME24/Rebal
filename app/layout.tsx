import type { Metadata } from "next";
import { Inter, Space_Mono } from "next/font/google";
import { Providers } from "./providers";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rebal — Ritual Chain",
  description: "Autonomous portfolio rebalancing on Ritual Chain using HTTP, LLM, and Scheduler precompiles",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceMono.variable}`}>
      <body style={{ backgroundColor: "#040508", color: "white", fontFamily: "var(--font-inter), Inter, sans-serif" }}>
        <Providers>
          <ToastProvider>
            {children}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
