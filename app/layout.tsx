import type { Metadata } from "next";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personalized Pomodoro",
  description: "Cross-device pomodoro timer with task and insight tracking"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="floating-control left">
          <ThemeToggle />
        </div>
        {children}
      </body>
    </html>
  );
}
