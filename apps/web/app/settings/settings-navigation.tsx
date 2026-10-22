"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import styles from "./settings-navigation.module.css";

type Section = { id: string; label: string; terms: string[] };
const sections: Section[] = [
  { id: "profile", label: "Profile", terms: ["name", "email", "github account"] },
  { id: "preferences", label: "Appearance & conversations", terms: ["theme", "dark", "light", "system", "text size", "font", "sync", "offline", "chat history"] },
  { id: "shortcuts", label: "Keyboard shortcuts", terms: ["shortcuts", "keyboard", "new chat", "search chats", "tabs", "sidebar"] },
  { id: "connections", label: "Connected repositories", terms: ["github", "repository", "repositories", "branch", "project", "connection"] },
  { id: "usage", label: "Usage & devices", terms: ["allowance", "free plan", "devices", "sessions", "usage", "sponsor"] },
];

export function SettingsNavigation({ admin }: { admin: boolean }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? sections.filter(section => `${section.label} ${section.terms.join(" ")}`.toLocaleLowerCase().includes(normalized))
      : sections;
  }, [query]);
  const normalized = query.trim().toLocaleLowerCase();
  const showAdmin = admin && (!normalized || "business operations administration admin".includes(normalized));

  return <nav className={styles.navigation} aria-label="Settings sections">
    <span className={styles.navLabel}>Your account</span>
    <label className={styles.search}>
      <Search size={16} aria-hidden="true" />
      <span className={styles.visuallyHidden}>Search settings</span>
      <input type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Search settings" aria-label="Search settings" />
      {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear settings search">Clear</button>}
    </label>
    <div className={styles.links} aria-live="polite">
      {filtered.map(section => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
      {showAdmin && <Link href="/admin">Business & operations</Link>}
      {filtered.length === 0 && <p className={styles.empty}>No matching settings sections.</p>}
    </div>
  </nav>;
}
