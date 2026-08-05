import type { Metadata } from "next";
import localFont from "next/font/local";
import { WalletProvider } from "@/components/kerb/WalletProvider";
import "./globals.css";

const technor = localFont({
  src: [{ path: "../fonts/technor-500.woff2", weight: "500", style: "normal" }],
  variable: "--font-display",
  display: "swap",
});

const switzer = localFont({
  src: [
    { path: "../fonts/switzer-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/switzer-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/switzer-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
});

const commitMono = localFont({
  src: [
    { path: "../fonts/commit-mono-400.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kerb",
  description:
    "Non-custodial stop, limit and DCA automation for the XRPL DEX, sealed inside a Flare TEE.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${technor.variable} ${switzer.variable} ${commitMono.variable}`}
    >
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
