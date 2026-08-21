import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "TodoTodoList",
  description: "Idea, todo, calendar, and GitHub human-file sync workspace"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
