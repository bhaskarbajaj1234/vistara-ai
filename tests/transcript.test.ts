import { describe, expect, it } from "vitest";
import { addUserText, appendTranscript, finalizeTurn, type ChatMessage } from "../app/services/transcript";

describe("transcript reducer", () => {
  it("merges fragments from the same speaker into one growing bubble", () => {
    let m: ChatMessage[] = [];
    m = appendTranscript(m, "user", "Hello");
    m = appendTranscript(m, "user", " there");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ role: "user", text: "Hello there", final: false });
  });

  it("starts a new bubble (and closes the old one) when the speaker changes", () => {
    let m = appendTranscript([], "user", "Hi");
    m = appendTranscript(m, "model", "Hello!");
    expect(m).toHaveLength(2);
    expect(m[0]?.final).toBe(true);
    expect(m[1]).toMatchObject({ role: "model", text: "Hello!", final: false });
  });

  it("finalizes the open bubble on turnComplete, and the next fragment opens a new bubble", () => {
    let m = appendTranscript([], "model", "Sure.");
    m = finalizeTurn(m);
    expect(m[0]?.final).toBe(true);
    m = appendTranscript(m, "model", "Another answer");
    expect(m).toHaveLength(2);
  });

  it("marks an interrupted bubble", () => {
    const m = finalizeTurn(appendTranscript([], "model", "Let me expl"), true);
    expect(m[0]).toMatchObject({ final: true, interrupted: true });
  });

  it("is a no-op for empty fragments and when nothing is open", () => {
    const m = appendTranscript([], "user", "x");
    expect(appendTranscript(m, "user", "")).toBe(m);
    expect(finalizeTurn([])).toEqual([]);
    const closed = finalizeTurn(m);
    expect(finalizeTurn(closed)).toBe(closed);
  });

  it("adds typed user text as a finished message and closes any open bubble first", () => {
    const open = appendTranscript([], "model", "Talking");
    const m = addUserText(open, "typed");
    expect(m).toHaveLength(2);
    expect(m[0]?.final).toBe(true);
    expect(m[1]).toMatchObject({ role: "user", text: "typed", final: true });
  });

  it("gives every message a unique, increasing id", () => {
    let m: ChatMessage[] = [];
    m = appendTranscript(m, "user", "a");
    m = appendTranscript(m, "model", "b");
    m = addUserText(m, "c");
    expect(m.map((x) => x.id)).toEqual([1, 2, 3]);
  });
});
