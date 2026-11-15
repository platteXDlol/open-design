// shortcut: temporary UI tracing for the "Send does nothing" / "folder button does nothing" reports; remove once fixed.
export function sendDebug(step: string, data?: Record<string, unknown>): void {
  console.log(`[od-send] ${step}`, data ?? {});
}

export function folderDebug(step: string, data?: Record<string, unknown>): void {
  console.log(`[od-folder] ${step}`, data ?? {});
}
