import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Costwise | Project Controls",
  description: "Enterprise cost management and project controls workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
