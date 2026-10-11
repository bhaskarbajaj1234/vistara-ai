"use client";

import { SendHorizontal } from "lucide-react";
import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "../services/transcript";

const MessageBubble = memo(function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <li className={`flex items-start gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar className="h-8 w-8 shrink-0">
        {!isUser && <AvatarImage src="/avatars/gemini.png" alt="" />}
        <AvatarFallback>{isUser ? "You" : "G"}</AvatarFallback>
      </Avatar>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        {message.text.trimStart()}
        {!message.final && <span className="ml-0.5 inline-block animate-pulse" aria-hidden="true">▍</span>}
        {message.interrupted && <span className="ml-2 text-xs opacity-60">(interrupted)</span>}
      </div>
    </li>
  );
});

interface Props {
  messages: ChatMessage[];
  canSend: boolean;
  onSend: (text: string) => boolean;
}

export const ChatPanel = memo(function ChatPanel({ messages, canSend, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onSend(draft)) setDraft("");
  };

  return (
    <section className="flex h-[60vh] min-h-[320px] w-full flex-col rounded-xl border bg-card lg:h-auto" aria-label="Conversation">
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Live captions of the conversation will appear here.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-live="polite">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t p-3">
        <label htmlFor="chat-input" className="sr-only">
          Type a message to Gemini
        </label>
        <input
          id="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canSend}
          placeholder={canSend ? "Type a message…" : "Start a session to type"}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        />
        <Button type="submit" disabled={!canSend || !draft.trim()} className="gap-2">
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          Send
        </Button>
      </form>
    </section>
  );
});
