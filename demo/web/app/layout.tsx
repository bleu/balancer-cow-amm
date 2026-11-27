import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const manrope = localFont({
  src: "../public/fonts/manrope-latin.woff2",
  variable: "--font-warden",
  display: "swap",
  weight: "400 800",
});
export const metadata: Metadata = {
  title: "Warden — Set a portfolio. Warden watches it.",
  description:
    "Explore onchain baskets, see every asset, and follow your curator. Warden brings your portfolio into view.",
  icons: { icon: "/warden-eye.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
