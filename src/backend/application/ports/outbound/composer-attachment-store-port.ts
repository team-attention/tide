// Outward port: materialize Composer image attachments into the Thread
// workspace so their paths can be referenced in the message the Agent receives.
// See docs_v2/specs/composer-image-attachments.md.

export interface ComposerAttachmentInput {
  name: string;
  mediaType: string;
  dataBase64: string;
}

export interface ComposerAttachmentStorePort {
  /**
   * Write each attachment to a file under `cwd` and return the absolute paths,
   * in the same order as the inputs.
   */
  materialize(input: {
    cwd: string;
    attachments: ComposerAttachmentInput[];
  }): Promise<string[]>;
}
