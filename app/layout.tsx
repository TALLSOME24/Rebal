import type { Metadata } from "next";
import { Inter, Space_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "Rebal — Ritual Chain",
  description: "AI portfolio rebalancer built on Ritual Chain with HTTP, LLM, and Scheduler precompiles",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceMono.variable}`}>
      <body className="font-body" style={{backgroundColor:`#0d0d0d`}}>
        <div style={{
          position:`fixed`,
          inset:0,
          backgroundImage:`radial-gradient(circle, rgba(124,58,237,0.18) 1px, transparent 1px)`,
          backgroundSize:`28px 28px`,
          pointerEvents:`none`,
          zIndex:0
        }} />
        <div style={{position:`relative`,zIndex:1}}>
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}