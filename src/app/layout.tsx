import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NIPP Portal Agent',
  description: 'AI agent for the NIPP property-management portal',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
