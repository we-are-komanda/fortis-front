import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { IBM_Plex_Mono, Manrope, Plus_Jakarta_Sans, Syne } from "next/font/google";
import { ThemeProvider } from "@/shared/ui/theme-provider";
import "./globals.css";
import { IdentityBoundary } from "@/shared/ui/identity-boundary";
import { RuntimeProvider } from "@/shared/ui/runtime-provider";

const jakartaFont = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const displayFont = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

const bodyFont = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "700", "800"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Fortis — Планирование конфигураций безопасности",
  description: "Планирование конфигураций и бюджета безопасности объекта",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${jakartaFont.variable} ${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <body>
        <AntdRegistry>
          <ThemeProvider><RuntimeProvider><IdentityBoundary>{children}</IdentityBoundary></RuntimeProvider></ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
