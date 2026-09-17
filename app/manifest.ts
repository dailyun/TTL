import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "TodoTodoList", short_name: "Todo", lang: "zh-CN",
    description: "日常事项、日历与执行回顾", start_url: "/today", scope: "/",
    display: "standalone", background_color: "#f5f7f4", theme_color: "#276c63",
    icons: [
      { src: "/icons/todo-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/todo-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/todo-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
