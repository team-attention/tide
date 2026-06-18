# Terminal OSC 8 Hyperlinks

Terminal applications can attach explicit hyperlink targets to arbitrary label
text with OSC 8. Tide preserves those links as cell metadata so labels like
`Open docs` or URL-looking labels can open the program-specified target.

## Use Cases

### UC-1: Explicit Hyperlink Targets

When a program writes text inside an OSC 8 hyperlink span, each printed cell in
the span stores the target URI. Link underline rendering uses this explicit
range, and Cmd/Ctrl-click opens the target URI.

### UC-2: Explicit Target Priority

If the visible label also looks like a URL, Tide opens the OSC 8 target instead
of the visible URL text. This matches terminal-app intent and allows short links,
redirects, and non-URL labels to work.

## Business Rules

- BR-1: OSC 8 URI metadata is copied from the terminal engine cell into
  `TerminalCell.hyperlink`.
- BR-2: Adjacent cells with the same URI are coalesced into row-local hyperlink
  ranges for rendering and click lookup.
- BR-3: Explicit hyperlink lookup runs before regex URL extraction.
- BR-4: Existing regex URL detection remains available for plain text output
  with no OSC 8 metadata.
