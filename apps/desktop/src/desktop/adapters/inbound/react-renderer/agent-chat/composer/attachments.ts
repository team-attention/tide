// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// Read any image/* items from a clipboard paste and hand them to the composer
// as base64 attachments. Non-image pastes fall through to the default (text).
export function handleComposerPaste(
  event: ClipboardEvent,
  onAddAttachment?: (attachment: {
    name: string;
    mediaType: string;
    dataBase64: string;
  }) => void,
): void {
  if (onAddAttachment === undefined) {
    return;
  }
  const items = event.clipboardData?.items;
  if (items === undefined) {
    return;
  }
  const images: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file !== null) {
        images.push(file);
      }
    }
  }
  if (images.length === 0) {
    return;
  }
  // Pasting an image should attach it, not insert the OS clipboard text path.
  event.preventDefault();
  for (const file of images) {
    attachImageFile(file, onAddAttachment);
  }
}

// Reads an image File as base64 and adds it as a composer attachment. Shared by
// the paste handler and the "Files and images" picker.
export function attachImageFile(
  file: File,
  onAddAttachment: (attachment: { name: string; mediaType: string; dataBase64: string }) => void,
): void {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;
    if (typeof result !== "string") {
      return;
    }
    const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
    onAddAttachment({
      name: file.name.length > 0 ? file.name : "pasted-image.png",
      mediaType: file.type.length > 0 ? file.type : "image/png",
      dataBase64: base64,
    });
  };
  reader.readAsDataURL(file);
}
