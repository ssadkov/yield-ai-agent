import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/WalletProvider";
import { SolanaProvider } from "@/lib/SolanaProvider";
import { SolanaWalletRestore } from "@/components/SolanaWalletRestore";
import { AptosWalletRestore } from "@/components/AptosWalletRestore";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Yield AI Agent",
  description: "Connect a Solana wallet and see the derived Aptos account for this site.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh antialiased">
        <WalletProvider>
          <SolanaProvider>
            <SolanaWalletRestore>
              <AptosWalletRestore>{children}</AptosWalletRestore>
            </SolanaWalletRestore>
          </SolanaProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
