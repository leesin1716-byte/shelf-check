// 앱 공통 레이아웃: 글꼴(Fraunces·Inter)과 메타데이터
import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Shelf Check — buy less, fix more",
  description:
    "YouCam AI Skin Analysis reads your skin, a Claude shopping agent reads the shelf you already own, and you buy only what closes the gap.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f0e8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
