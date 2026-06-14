import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AeroBrief // OPS — Global Aviation Weather Briefing",
  description:
    "Real-time METARs, TAFs, PIREPs, SIGMETs, and AI-generated go/no-go briefings for pilots worldwide.",
  keywords: "aviation weather, METAR, TAF, SIGMET, PIREP, flight briefing, VFR, IFR",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

