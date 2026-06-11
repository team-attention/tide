// Outward port: materialize Composer image attachments into Tide's OWN app-data
// dir (NOT the user's repo) so the bytes can be read back as inline base64 for the
// provider and as the transcript thumbnail — never committed, no .gitignore.
// See docs_v2/specs/composer-image-attachments.md.

export interface ComposerAttachmentInput {
  name: string;
  mediaType: string;
  dataBase64: string;
}

export interface ComposerAttachmentStorePort {
  /**
   * Write each attachment to a file under Tide's app-data attachments dir, keyed
   * by `threadId`, and return the absolute paths in input order.
   */
  materialize(input: {
    threadId: string;
    attachments: ComposerAttachmentInput[];
  }): Promise<string[]>;
}
