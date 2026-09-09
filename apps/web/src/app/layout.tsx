import type { Metadata } from 'next';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { messages } from '@/i18n/en';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: messages.appName,
  description: messages.tagline,
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${outfit.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
