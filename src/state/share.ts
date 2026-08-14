export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/** Copies one exact address without making the UI depend directly on the
 * browser clipboard, so success and refusal are both testable. */
export async function copyViewUrl(
  url: string,
  clipboard: ClipboardWriter | undefined
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
