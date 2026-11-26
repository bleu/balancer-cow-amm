import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Folio / MAG7 CoW AMM",
  description: "Explore and manage a curated MAG7 basket on BNB Chain or Base.",
  icons: { icon: "data:," },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
