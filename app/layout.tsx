import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "daylight · 오늘을 가볍게, 함께",
  description: "직접 정리하는 오늘의 할 일, 함께 보는 팀의 진행 상황, Google Calendar의 마일스톤.",
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
