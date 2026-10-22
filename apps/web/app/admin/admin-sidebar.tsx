"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ChartNoAxesCombined, CircleDollarSign, Cloud, LayoutDashboard, Megaphone, ShieldCheck, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator, useSidebar } from "@/components/ui/sidebar";

const sections = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "inference", label: "AI requests", icon: Sparkles },
  { id: "activity", label: "Daily activity", icon: ChartNoAxesCombined },
  { id: "cloud", label: "Cloud & sync", icon: Cloud },
  { id: "advertising", label: "Advertising", icon: Megaphone },
  { id: "costs", label: "Costs & acquisition", icon: CircleDollarSign },
];

export function AdminSidebar({ user }: { user: { name: string; image?: string | null } }) {
  const { setOpenMobile } = useSidebar();
  const [active, setActive] = useState("overview");
  useEffect(() => {
    const update = () => setActive(window.location.hash.slice(1) || "overview");
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return (
    <Sidebar collapsible="icon" aria-label="Administration navigation">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/app" />} tooltip="Freecoda app">
              <img src="/brand/freecoda-mark.svg" alt="" className="size-8" />
              <span className="flex flex-col gap-0.5"><strong>Freecoda</strong><span className="text-xs text-muted-foreground">Administration</span></span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Dashboard sections">
              <SidebarMenu>
                {sections.map(({ id, label, icon: Icon }) => <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    render={<a href={`#${id}`} />}
                    tooltip={label}
                    isActive={active === id}
                    aria-current={active === id ? "location" : undefined}
                    onClick={() => { setActive(id); setOpenMobile(false); }}
                  ><Icon aria-hidden="true" /><span>{label}</span></SidebarMenuButton>
                </SidebarMenuItem>)}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-start gap-2 px-2 py-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" /><p>Private workspace<br />Aggregate metrics only</p>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/app" />} tooltip="Back to app"><ArrowLeft aria-hidden="true" /><span>Back to app</span></SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/settings" />} tooltip="Your account" aria-label={`Account settings for ${user.name || "administrator"}`}>
              <Avatar>
                {user.image ? <AvatarImage src={user.image} alt="" /> : null}
                <AvatarFallback>{user.name?.trim().slice(0, 1).toUpperCase() || "A"}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col gap-0.5"><span className="truncate">{user.name || "Administrator"}</span><span className="text-xs text-muted-foreground">Administrator</span></span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
