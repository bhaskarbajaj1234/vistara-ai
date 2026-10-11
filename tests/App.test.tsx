// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../app/page";

class FakeAudioContext {
  state = "running";
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.stubGlobal("AudioContext", FakeAudioContext);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home page", () => {
  it("renders the idle UI with the text box disabled until a session is live", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Vistara AI" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /start/i })).toBeTruthy();
    expect((screen.getByLabelText("Type a message to Gemini") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Press Start to begin a live session")).toBeTruthy();
  });

  it("shows a readable error when the camera/mic permission is denied", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) },
    });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("permission was denied"));
    expect(screen.getByRole("button", { name: /start/i })).toBeTruthy(); // can retry
  });
});
