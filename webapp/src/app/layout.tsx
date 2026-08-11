import type { Metadata } from "next";
import localFont from "next/font/local";
import { WalletProvider } from "@/components/kerb/WalletProvider";
import "./globals.css";

const instrumentSans = localFont({
  src: [
    {
      path: "../fonts/instrument-sans-var.woff2",
      weight: "400 700",
      style: "normal",
    },
  ],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kerb",
  description:
    "Non-custodial stop, limit and DCA automation for the XRPL DEX, sealed inside a Flare TEE.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={instrumentSans.variable}>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
