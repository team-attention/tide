import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers, WorkbenchImageLoadResult } from "../support/types.ts";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { styled } from "styled-components";
import { WorkbenchPaneSurface } from "./workbench-pane.parts.tsx";

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
    <ImagePaneSurface data-pane-surface-kind="image">
      <ImageStage>
        {dataBase64.length > 0 ? (
          <ImageMedia data-workbench-image-media="true" src={src} alt={props.pane.relativePath ?? props.pane.title} />
        ) : (
          <ImageEmpty>
            {props.pane.root === undefined || loadSettled ? "Image unavailable" : "Loading image..."}
          </ImageEmpty>
        )}
      </ImageStage>
      <ImageMeta>
        <span>{props.pane.relativePath ?? props.pane.title}</span>
        {typeof (image?.byteLength ?? props.pane.byteLength) === "number" ? (
          <span>{formatBytes(image?.byteLength ?? props.pane.byteLength ?? 0)}</span>
        ) : null}
      </ImageMeta>
    </ImagePaneSurface>
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

const ImagePaneSurface = styled(WorkbenchPaneSurface)`
  flex: 1 1 auto;
  height: auto;
  display: grid;
  grid-template-rows: minmax(0, 1fr) 34px;
  padding: 0;
  background: var(--tide-bg);
`;

const ImageStage = styled.div`
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background:
    linear-gradient(45deg, color-mix(in srgb, var(--tide-surface) 70%, transparent) 25%, transparent 25%),
    linear-gradient(-45deg, color-mix(in srgb, var(--tide-surface) 70%, transparent) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--tide-surface) 70%, transparent) 75%),
    linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--tide-surface) 70%, transparent) 75%);
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
  background-size: 18px 18px;
`;

const ImageMedia = styled.img`
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
`;

const ImageEmpty = styled.div`
  color: var(--tide-muted);
  font-size: 13px;
`;

const ImageMeta = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  border-top: 1px solid var(--tide-line);
  color: var(--tide-muted);
  font: 12px/1.2 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
