import type { Metadata } from "next";
import AgGridGlobalConfig from "@/components/ag-grid-global-config";
import "./globals.css";
import "./table-grid-enhancements.css";

export const metadata: Metadata = {
  title: "Costwise | Project Controls",
  description: "Enterprise cost management and project controls workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <AgGridGlobalConfig />
        {children}
      </body>
    </html>
  );
}
