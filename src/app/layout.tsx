import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Payanam Operator Portal",
  description: "Vehicle operator management portal for Payanam",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
