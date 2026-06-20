import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers, WorkbenchImageLoadResult } from "../support/types.ts";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

export function WorkbenchImagePane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const initialImage = imageFromPane(props.pane);
  const [loadedImage, setLoadedImage] = useState<WorkbenchImageLoadResult | null>(initialImage);
  const [loadSettled, setLoadSettled] = useState(initialImage !== null);
  const image = loadedImage ?? initialImage;
  const mimeType = image?.mimeType ?? props.pane.mimeType ?? "image/png";
  const dataBase64 = image?.dataBase64 ?? "";
  const src = `data:${mimeType};base64,${dataBase64}`;

  useEffect(() => {
    const inlineImage = imageFromPane(props.pane);
    if (inlineImage !== null) {
      setLoadedImage(inlineImage);
      setLoadSettled(true);
      return;
    }
    if (props.pane.root === undefined || props.pane.relativePath === undefined) {
      setLoadedImage(null);
      setLoadSettled(true);
      return;
    }
    let cancelled = false;
    setLoadedImage(null);
    setLoadSettled(false);
    void props.handlers.onLoadWorkbenchImage(props.pane.root, props.pane.relativePath).then((result) => {
      if (!cancelled) {
        setLoadedImage(result);
        setLoadSettled(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    props.handlers,
    props.pane.paneId,
    props.pane.revision,
    props.pane.root,
    props.pane.relativePath,
    props.pane.dataBase64,
    props.pane.mimeType,
    props.pane.byteLength,
  ]);

  return (
    <div className="workbench-pane-content workbench-pane-content--image">
      <div className="workbench-image__stage">
        {dataBase64.length > 0 ? (
          <img className="workbench-image__media" src={src} alt={props.pane.relativePath ?? props.pane.title} />
        ) : (
          <div className="workbench-image__empty">
            {props.pane.root === undefined || loadSettled ? "Image unavailable" : "Loading image..."}
          </div>
        )}
      </div>
      <div className="workbench-image__meta">
        <span>{props.pane.relativePath ?? props.pane.title}</span>
        {typeof (image?.byteLength ?? props.pane.byteLength) === "number" ? (
          <span>{formatBytes(image?.byteLength ?? props.pane.byteLength ?? 0)}</span>
        ) : null}
      </div>
    </div>
  );
}

function imageFromPane(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
): WorkbenchImageLoadResult | null {
  if (
    typeof pane.mimeType !== "string" ||
    typeof pane.dataBase64 !== "string" ||
    pane.dataBase64.length === 0
  ) {
    return null;
  }
  return {
    mimeType: pane.mimeType,
    dataBase64: pane.dataBase64,
    byteLength: typeof pane.byteLength === "number" ? pane.byteLength : 0,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
