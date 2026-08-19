// Root layout wrapping every page. Where the <html>/<body> tags live, and
// where global CSS (including Tailwind) gets loaded.
import { Unbounded, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Three fonts, three jobs: Unbounded is the chunky, playful display face
// for the hero title and the winner's name -- gives this a "leaderboard"
// personality instead of a generic dashboard. Plus Jakarta Sans handles
// regular reading text. JetBrains Mono is reserved for numbers (scores,
// message counts) so they read like a data readout. next/font self-hosts
// all three at build time, so there's no runtime request to Google Fonts.
const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["600", "800"],
  variable: "--font-display",
});
const plusJakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-mono",
});

export const metadata = {
  title: "Funniest Friend",
  description: "Who's actually the funniest in the group chat, based on real reaction data.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${plusJakarta.variable} ${jetbrainsMono.variable}`}>
      <body className="font-[family-name:var(--font-body)]">
        {/* Fixed, pointer-events-none ambient layers -- see globals.css.
            Rendered once here instead of per-page so they never repaint
            on scroll or route change. */}
        <div className="mesh-glow" aria-hidden="true" />
        <div className="grain-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
