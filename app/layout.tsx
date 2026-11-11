import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "daylight",
  description: "할 일, 개인 일정, 프로젝트 기록을 정리하는 플래너",
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
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
