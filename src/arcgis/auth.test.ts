import { describe, expect, it, vi } from "vitest";
import {
  disableInteractiveAuth, isSecuredResourceRefusal, SecuredResourceError,
  type CredentialBroker
} from "./auth";

function fakeManager(): CredentialBroker & {
  dialogHandlers: (() => void)[];
  removed: number;
} {
  const dialogHandlers: (() => void)[] = [];
  return {
    dialogHandlers,
    removed: 0,
    dialog: null,
    getCredential: () => Promise.resolve({ token: "real-credential" }),
    on(_type, handler) {
      dialogHandlers.push(handler);
      return { remove: () => { this.removed += 1; } };
    }
  };
}

describe("interactive auth refusal", () => {
  it("rejects instead of prompting, so the caller can fall back", async () => {
    const manager = fakeManager();
    disableInteractiveAuth(manager);
    await expect(manager.getCredential("https://example.com/secured"))
      .rejects.toBeInstanceOf(SecuredResourceError);
  });

  /* The point of the whole module. Hiding the dialog leaves the credential
   * promise pending and every dependent load hangs forever; the measured
   * symptom on 5.1 was a 20-second timeout, not an error.
   */
  it("settles promptly rather than leaving the caller pending", async () => {
    const manager = fakeManager();
    disableInteractiveAuth(manager);
    const pending = manager.getCredential("https://example.com/secured");
    const race = await Promise.race([
      pending.then(() => "resolved", () => "rejected"),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 50))
    ]);
    expect(race).toBe("rejected");
  });

  it("names the resource it refused, for the notice and the console", async () => {
    const manager = fakeManager();
    disableInteractiveAuth(manager);
    const error = await manager.getCredential("https://example.com/layers/3")
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(SecuredResourceError);
    expect((error as SecuredResourceError).url).toBe("https://example.com/layers/3");
    expect((error as SecuredResourceError).message).toContain("https://example.com/layers/3");
  });

  it("reports every refusal, so a secured layer is diagnosable, not just silent", async () => {
    const manager = fakeManager();
    const seen: string[] = [];
    const policy = disableInteractiveAuth(manager, (error) => seen.push(error.url));
    await manager.getCredential("https://example.com/a").catch(() => undefined);
    await manager.getCredential("https://example.com/b").catch(() => undefined);
    expect(seen).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(policy.refusals).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("tears down a dialog if some other code path still builds one", () => {
    const manager = fakeManager();
    const destroy = vi.fn();
    disableInteractiveAuth(manager);
    manager.dialog = { destroy, visible: true };
    manager.dialogHandlers.forEach((handler) => handler());
    expect(manager.dialog.visible).toBe(false);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("survives a dialog-create with no dialog attached", () => {
    const manager = fakeManager();
    disableInteractiveAuth(manager);
    manager.dialog = null;
    expect(() => manager.dialogHandlers.forEach((handler) => handler())).not.toThrow();
  });

  /* Measured on 5.1.15: the caller does not receive our error object. The
   * SDK catches it and re-throws `[request:server]: <our message>`, so the
   * prototype is gone by the time anything downstream inspects it.
   */
  it("is still recognisable after the SDK rewraps it", () => {
    const original = new SecuredResourceError("https://basemapstyles-api.arcgis.com/x");
    const wrapped = new Error(`[request:server]: ${original.message}`);
    expect(wrapped).not.toBeInstanceOf(SecuredResourceError);
    expect(isSecuredResourceRefusal(wrapped)).toBe(true);
    expect(isSecuredResourceRefusal(original)).toBe(true);
  });

  it("does not claim unrelated failures were auth refusals", () => {
    expect(isSecuredResourceRefusal(new Error("network unreachable"))).toBe(false);
    expect(isSecuredResourceRefusal(new Error("[request:server]: 500"))).toBe(false);
    expect(isSecuredResourceRefusal(null)).toBe(false);
    expect(isSecuredResourceRefusal("anonymous and cannot sign in")).toBe(false);
  });

  it("restores the SDK's own behaviour", async () => {
    const manager = fakeManager();
    const policy = disableInteractiveAuth(manager);
    policy.restore();
    await expect(manager.getCredential("https://example.com/secured"))
      .resolves.toEqual({ token: "real-credential" });
    expect(manager.removed).toBe(1);
  });
});
