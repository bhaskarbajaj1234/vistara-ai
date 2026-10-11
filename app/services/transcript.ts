export type Role = "user" | "model";

export interface ChatMessage {
  id: number;
  role: Role;
  text: string;
  /** false while the speaker is still talking (the bubble keeps growing). */
  final: boolean;
  interrupted?: boolean;
}

const nextId = (messages: ChatMessage[]): number => (messages.length ? (messages[messages.length - 1] as ChatMessage).id + 1 : 1);

/**
 * Append a transcription fragment. Fragments from the same speaker extend the open bubble;
 * a change of speaker closes the previous bubble and opens a new one.
 */
export function appendTranscript(messages: ChatMessage[], role: Role, fragment: string): ChatMessage[] {
  if (!fragment) return messages;
  const last = messages[messages.length - 1];
  if (last && last.role === role && !last.final) {
    return [...messages.slice(0, -1), { ...last, text: last.text + fragment }];
  }
  const closed = last && !last.final ? [...messages.slice(0, -1), { ...last, final: true }] : messages;
  return [...closed, { id: nextId(messages), role, text: fragment, final: false }];
}

/** Close the open bubble (turn finished, or the model was interrupted mid-sentence). */
export function finalizeTurn(messages: ChatMessage[], interrupted = false): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.final) return messages;
  return [...messages.slice(0, -1), { ...last, final: true, ...(interrupted ? { interrupted: true } : {}) }];
}

/** A message the user typed (complete immediately). */
export function addUserText(messages: ChatMessage[], text: string): ChatMessage[] {
  const closed = finalizeTurn(messages);
  return [...closed, { id: nextId(closed), role: "user", text, final: true }];
}
