"use client";

import { useState } from "react";
import styles from "./user-avatar.module.css";

export function UserAvatar({ image, name, className = "" }: { image?: string | null; name?: string | null; className?: string }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  let source = "";
  try {
    const url = new URL(image || "");
    if (url.protocol === "https:" || url.protocol === "http:") source = url.href;
  } catch { /* Invalid and missing images use initials. */ }
  const initials = name?.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase() || "Y";
  return <span className={`${styles.avatar} ${className}`} role="img" aria-label={name ? `${name} (you)` : "You"}>
    {source && failedImage !== source ? <img src={source} alt="" width={28} height={28} referrerPolicy="no-referrer" onError={() => setFailedImage(source)} /> : initials}
  </span>;
}
