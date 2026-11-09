import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "daylight",
  description: "일일 할 일과 팀 마일스톤",
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
