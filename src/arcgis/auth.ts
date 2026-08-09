/* Never challenge a visitor for credentials.
 *
 * This dashboard is anonymous, public, and read-only. There is no account to
 * sign in to and nothing a visitor could type into a username box that would
 * help. But the SDK does not know that: whenever it touches a resource that
 * answers 401 -- a key-gated basemap style, a hosted feature service whose
 * sharing was changed, a portal item that moved -- IdentityManager builds a
 * modal and asks for a username and password. On a public page that is worse
 * than the resource simply being missing: it looks like a phishing prompt on
 * someone else's site, and a visitor cannot dismiss it into a working app.
 *
 * Measured on 5.1.15 with a key-gated basemap style: the 401 produced exactly
 * that modal, and the load promise then stayed pending until it was answered.
 * So suppressing the dialog alone is not enough -- hiding it leaves every
 * caller hanging forever on a promise nobody can settle. The resource has to
 * *fail*, promptly, so the caller can fall back.
 *
 * `getCredential` is the one place all of this converges, for every secured
 * resource and not just basemaps, which is what makes it the right choke
 * point rather than a basemap-specific patch.
 *
 * The module deliberately does not import the SDK: it takes the manager as an
 * argument so the policy is unit-testable without a browser, and so the only
 * SDK-coupled line in the app is the single call site that passes the real
 * singleton in.
 */

/* A marker carried in the message text.
 *
 * `instanceof` is not reliable across this boundary: the SDK catches what
 * `getCredential` rejects with and re-throws its own `[request:server]`
 * error, preserving the message but not the prototype. Observed on 5.1.15 --
 * the outer error a caller actually sees is an esri request error whose
 * message merely contains ours. Anything deciding "was this an auth
 * refusal?" has to match on content, so the content is a constant rather
 * than prose someone will later reword.
 */
const REFUSAL_MARKER = "anonymous and cannot sign in";

/** Thrown in place of a sign-in prompt. */
export class SecuredResourceError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(
      `This dashboard is ${REFUSAL_MARKER}, so the secured resource ` +
      `at ${url} is unavailable.`
    );
    this.name = "SecuredResourceError";
    this.url = url;
  }
}

/**
 * True for our refusal, whether it arrives intact or wrapped by the SDK.
 * Prefer this over `instanceof` anywhere the error has passed through the
 * SDK's request pipeline.
 */
export function isSecuredResourceRefusal(error: unknown): boolean {
  if (error instanceof SecuredResourceError) return true;
  return error instanceof Error && error.message.includes(REFUSAL_MARKER);
}

/** The part of IdentityManager this policy needs. Structural, so tests can fake it. */
export interface CredentialBroker {
  getCredential(url: string, options?: unknown): Promise<unknown>;
  on(type: "dialog-create", handler: () => void): { remove(): void };
  dialog?: { destroy?: () => void; visible?: boolean } | null;
}

export interface AuthPolicy {
  /** Every secured resource refused so far, in order, for diagnostics. */
  readonly refusals: readonly string[];
  /** Restore the SDK's own behaviour. Primarily for tests. */
  restore(): void;
}

/**
 * Makes every credential challenge fail immediately instead of prompting.
 *
 * @param manager the IdentityManager singleton (`@arcgis/core/identity/IdentityManager`)
 * @param onRefusal notified for each refused resource, for logging or UI notice
 */
export function disableInteractiveAuth(
  manager: CredentialBroker,
  onRefusal?: (error: SecuredResourceError) => void
): AuthPolicy {
  const refusals: string[] = [];
  const originalGetCredential = manager.getCredential.bind(manager);

  manager.getCredential = (url: string): Promise<unknown> => {
    const error = new SecuredResourceError(url);
    refusals.push(url);
    onRefusal?.(error);
    return Promise.reject(error);
  };

  // Belt and braces. `getCredential` is the documented path and rejecting it
  // means no dialog is ever built, but the SDK is large and this costs one
  // listener: if some other code path constructs the modal anyway, tear it
  // down rather than let it sit on top of a public page.
  const handle = manager.on("dialog-create", () => {
    const dialog = manager.dialog;
    if (!dialog) return;
    dialog.visible = false;
    dialog.destroy?.();
  });

  return {
    refusals,
    restore() {
      manager.getCredential = originalGetCredential;
      handle.remove();
    }
  };
}
