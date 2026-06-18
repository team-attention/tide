# Terminal Graphics Protocol

## Goal

Support terminal image protocols without letting binary graphics payloads leak
into the text grid.

## PTY Stream Handling

The PTY event loop scans raw output before passing it to the VT parser:

- Kitty graphics APC: `ESC _ G ... ESC \`
- Sixel DCS: `ESC P ... q ... ESC \`

Recognized graphics payloads are stripped from the text stream and emitted as
terminal graphics events. Non-Kitty APC and non-Sixel DCS payloads are passed
back to the existing parser unchanged.

## Kitty Graphics

Implemented support:

- Direct APC payloads beginning with `G`.
- PNG payloads with `f=100`.
- Raw RGB payloads with `f=24`, `s=<pixels>`, and `v=<pixels>`.
- Raw RGBA payloads with `f=32`, `s=<pixels>`, and `v=<pixels>`.
- Base64 image data after the `;` separator.
- Chunked transfer using `m=1`; the final chunk decodes and places the image.
- Transmit-only action `a=t`, storing by `i=<image-id>`.
- Stored-image placement action `a=p`.
- Transmit-and-place action `a=T` and the default action.
- Cell placement using `c=<cols>` and `r=<rows>`, falling back to image pixel
  dimensions when omitted.
- Delete action `a=d` clears active graphics.

Decoded PNG and raw Kitty image payloads are normalized to RGBA pixels before
they enter the renderer. Active terminal graphics placements render each frame
by uploading those pre-decoded pixels through the GPU raster texture pipeline.

## Sixel

Implemented subset:

- Sixel DCS payloads whose final DCS action is `q`.
- Raster attributes (`" Pan ; Pad ; Ph ; Pv`).
- RGB palette entries (`# Pn ; 2 ; R ; G ; B`).
- Repeat introducer (`! Pn Ch`).
- Carriage return (`$`) and sixel newline (`-`).
- Basic sixel data bytes (`?` through `~`).

Decoded Sixel pixels are stored as RGBA pixels and rendered through the same
GPU raster texture path as Kitty images. The decoder uses a bounded flat RGBA
buffer rather than per-pixel hash storage.

## Limits

- Active rendered Kitty images are capped at 128 placements per terminal.
- Terminal image dimensions are capped at 4096 by 4096 pixels.
- Sixel repeat runs that would exceed the terminal image dimension cap are
  rejected before iterating.
- The Sixel decoder intentionally covers the common bitmap subset; advanced
  scrolling/transparent background policies and HLS palette mode are not
  implemented.
