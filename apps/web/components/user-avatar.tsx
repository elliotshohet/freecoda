"use client";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { cn } from "@/lib/utils";
import styles from "./user-avatar.module.css";

export function UserAvatar({ image, name, className = "" }: { image?: string | null; name?: string | null; className?: string }) {
  let source = "";
  try {
    const url = new URL(image || "");
    if (url.protocol === "https:" || url.protocol === "http:") source = url.href;
  } catch { /* Invalid and missing images use initials. */ }
  const initials = name?.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase() || "Y";
  return <Avatar className={cn(styles.avatar, className)} aria-label={name ? `${name} (you)` : "You"}>
    {source && <AvatarImage src={source} alt="" referrerPolicy="no-referrer" />}
    <AvatarFallback>{initials}</AvatarFallback>
  </Avatar>;
}
