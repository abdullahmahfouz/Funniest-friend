// This file wraps every page in the app. Next.js requires a root layout
// like this one -- it's where the <html> and <body> tags live, and where
// we load our global CSS (including Tailwind).
import "./globals.css";

export const metadata = {
  title: "Funniest Friend",
  description: "Who's actually the funniest in the group chat, based on real reaction data.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
