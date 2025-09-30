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

          // Extract text content - look ahead across multiple lines if needed
          let textContent = "";
          const restOfLine = line.substring(offset + match.length);

          // Build remaining source from current position
          const remainingSource = [
            restOfLine,
            ...lines.slice(lineIndex + 1),
          ].join("\n");

          // Match text content until we hit < or { (start of JSX element or expression)
          const textMatch = remainingSource.match(/^([^<{]+)/);
          if (textMatch) {
            // Preserve newlines but trim leading/trailing whitespace
            textContent = textMatch[1].trim();
          }

          // Extract className from attrs
          const classNameMatch = attrs.match(/className=["']([^"']+)["']/);
          const className = classNameMatch ? classNameMatch[1] : "";

          // Build data attributes (Raw JSON for dev mode - fastest and most debuggable)
          // data-sg-el: Primary identifier (file:line:col) for AST location
          // data-component-content: JSON with text + className, no encoding
          const dataSgEl = `${filePath}:${lineNumber}:${columnNumber}`;

          // Build JSON object with text and className
          const contentObj = {
            text: textContent,
            className: className,
          };

          // Raw JSON - no encoding overhead, perfect for debugging
          // Escape single quotes to avoid breaking HTML attribute (we use single quotes for the attribute)
          const dataComponentContent = JSON.stringify(contentObj).replace(
            /'/g,
            "&#39;"
          );

          // Add attributes (using single quotes for data-component-content to avoid JSON double-quote conflicts)
          const newAttrs = attrs.trim()
            ? `${attrs} data-sg-el="${dataSgEl}" data-component-content='${dataComponentContent}'`
            : ` data-sg-el="${dataSgEl}" data-component-content='${dataComponentContent}'`;

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
