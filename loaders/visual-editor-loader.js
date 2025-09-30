module.exports = function (source) {
  // Only process in development
  if (process.env.NODE_ENV !== "development") {
    return source;
  }

  // Get file path from loader context
  const filePath = this.resourcePath
    ? this.resourcePath.replace(process.cwd(), "").replace(/^\//, "")
    : "unknown";

  // Skip non-JSX/TSX files
  if (!/\.(jsx?|tsx?)$/.test(filePath)) {
    return source;
  }

  try {
    console.log("[Visual Editor Loader] Processing:", filePath);

    // Process line-by-line to add data-sg-el attributes
    // Format: data-sg-el="file:line:col"

    const lines = source.split("\n");
    const editableTags = [
      "p",
      "span",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "button",
      "a",
      "label",
    ];

    const modifiedLines = lines.map((line, lineIndex) => {
      const lineNumber = lineIndex + 1;

      // Match opening JSX tags (both self-closing and regular)
      // Regex: <tagName attrs> or <tagName attrs />
      return line.replace(
        /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?>)/g,
        (match, tagName, attrs, closingBracket, offset) => {
          // Skip if not an editable tag
          if (!editableTags.includes(tagName)) {
            return match;
          }

          // Skip if already has data-sg-el
          if (attrs.includes("data-sg-el=")) {
            return match;
          }

          // Column number is the position in the line
          const columnNumber = offset;

          // Build data attribute: Single source of truth for element location
          // Format: file:line:col
          // All content (text, className, attributes) will be read from DOM at runtime
          const dataSgEl = `${filePath}:${lineNumber}:${columnNumber}`;

          // Add attribute (single, minimal, clean)
          const newAttrs = attrs.trim()
            ? `${attrs} data-sg-el="${dataSgEl}"`
            : ` data-sg-el="${dataSgEl}"`;

          return `<${tagName}${newAttrs}${closingBracket}`;
        }
      );
    });

    const modifiedSource = modifiedLines.join("\n");

    // Return modified source with data-sg-el attributes (no source bundling)
    return modifiedSource;
  } catch (error) {
    console.warn(
      `[Visual Editor Loader] Error processing ${filePath}:`,
      error.message
    );
    return source;
  }
};
