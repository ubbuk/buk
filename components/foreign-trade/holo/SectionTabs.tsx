"use client";

import { useState } from "react";
import { Info, MessagesSquare, BarChart3, History, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import s from "./holo.module.css";

/** The reference's bottom tab strip, as jump links to the sections that exist on this page (no new views or features). */
export function SectionTabs({ attachments, showQuotes, showDiscussion }: { attachments: number; showQuotes: boolean; showDiscussion: boolean }) {
  const [on, setOn] = useState("info");
  const tabs = [
    { id: "info", label: "Ерөнхий мэдээлэл", Icon: Info },
    { id: "attachments", label: `Хавсралт (${attachments})`, Icon: Paperclip },
    { id: "history", label: "Батлах түүх", Icon: History },
    ...(showQuotes ? [{ id: "quotes", label: "Үнийн судалгаа", Icon: BarChart3 }] : []),
    ...(showDiscussion ? [{ id: "discussion", label: "Хэлэлцүүлэг", Icon: MessagesSquare }] : []),
  ];
  return (
    <nav className={s.tabs} aria-label="Хуудасны хэсгүүд">
      {tabs.map(({ id, label, Icon }) => (
        <a
          key={id}
          href={`#${id}`}
          onClick={() => setOn(id)}
          aria-current={on === id ? "true" : undefined}
          className={cn(s.tab, on === id && s.tabOn, "focus-ring")}
        >
          <Icon className="size-4" /> {label}
        </a>
      ))}
    </nav>
  );
}
