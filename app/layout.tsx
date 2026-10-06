import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "墨读 PaperInk · iPad 文献阅读与批注",
  description: "在 iPad 上阅读 PDF、手写批注、圈选向 AI 提问。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "墨读",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
