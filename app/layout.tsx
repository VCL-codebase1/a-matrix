import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", baseUrl).toString();

  return {
    title: "A-Matrix — Product & Procurement Support",
    description:
      "Find technical products, clarify specifications, prepare quotation requests, and get A-Matrix customer support.",
    metadataBase: baseUrl,
    openGraph: {
      title: "A-Matrix Product & Procurement Support",
      description:
        "Technical product sourcing, quotations, order help, and customer support.",
      type: "website",
      images: [{ url: socialImage, width: 1736, height: 908 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "A-Matrix Product & Procurement Support",
      description:
        "Technical product sourcing, quotations, order help, and customer support.",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f2efe8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={plusJakartaSans.variable}>{children}</body>
    </html>
  );
}
