import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "./PwaRegistration.js";
import "./styles.css";

export const metadata: Metadata = {
  title: "TodoTodoList",
  description: "Idea, todo, calendar, and GitHub human-file sync workspace",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "TodoTodoList" },
  icons: { apple: "/icons/todo-180.png" }
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#276c63" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body><PwaRegistration />{children}</body>
    </html>
  );
}
