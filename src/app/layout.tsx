import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { WalletProvider } from "@/lib/WalletProvider";
import { SolanaProvider } from "@/lib/SolanaProvider";
import { SolanaWalletRestore } from "@/components/SolanaWalletRestore";
import { AptosWalletRestore } from "@/components/AptosWalletRestore";
import { ThemeProvider } from "@/lib/theme";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Yield AI Agent",
  description: "Private advisor desk for Yield AI — wallet, deposit, and verifiable private AI.",
};

const themeBootScript = `
(() => {
  try {
    const key = "yield-agent-theme";
    const stored = localStorage.getItem(key);
    const theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  } catch {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <WalletProvider>
            <SolanaProvider>
              <SolanaWalletRestore>
                <AptosWalletRestore>{children}</AptosWalletRestore>
              </SolanaWalletRestore>
            </SolanaProvider>
          </WalletProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
