"use client";

import type { ReactNode } from "react";
import { Mark } from "./chrome";
import { UserAvatar } from "./user-avatar";
import { Bubble, BubbleContent } from "./ui/bubble";
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "./ui/message";
import { Marker, MarkerContent } from "./ui/marker";

/** Presentation only: transport, delivery status and ownership stay with each client. */
export function AgentMessage({ role, image, name, children, footer }: {
  role: "user" | "assistant" | "system";
  image?: string | null;
  name?: string | null;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (role === "system") return <Marker><MarkerContent>{children}</MarkerContent></Marker>;
  const align = role === "user" ? "end" : "start";
  return (
    <Message align={align} aria-label={role === "user" ? "Your message" : "Coda response"}>
      <MessageAvatar>
        {role === "user" ? <UserAvatar image={image} name={name} /> : <span className="flex size-8 items-center justify-center" role="img" aria-label="Coda"><Mark /></span>}
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>{role === "user" ? "You" : "Coda"}</MessageHeader>
        <Bubble align={align} variant={role === "user" ? "muted" : "ghost"} className="max-w-full">
          <BubbleContent>{children}</BubbleContent>
        </Bubble>
        {footer && <MessageFooter>{footer}</MessageFooter>}
      </MessageContent>
    </Message>
  );
}
