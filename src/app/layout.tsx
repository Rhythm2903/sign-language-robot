import type { Metadata } from "next";
import React, { type ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Sign Language Assistance Robot",
  description:
    "An interactive browser-based platform to learn and translate sign language using AI agents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-900 text-white">{children}</body>
    </html>
  );
}
