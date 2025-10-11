import { parse } from "@babel/parser";
import { walk } from "estree-walker";
import MagicString from "magic-string";

export default function softgenElementTagger(source) {
  if (process.env.NODE_ENV !== "development") {
    return source;
  }

  const filePath = this.resourcePath
    ? this.resourcePath.replace(process.cwd(), "").replace(/^\//, "")
    : "unknown";

  if (!/\.(jsx?|tsx?)$/.test(filePath)) {
    return source;
  }

  if (filePath.includes("node_modules")) {
    return source;
  }

  try {
    const ast = parse(source, {
      sourceType: "module",
      plugins: [
        "jsx",
        "typescript",
        "decorators-legacy",
        "classProperties",
        "dynamicImport",
      ],
    });

    const magicString = new MagicString(source);

    // Elements to EXCLUDE from tagging:
    // - React Fragments (not real DOM elements)
    // - Document structure (_document.tsx elements: Html, Head, body, Main, NextScript)
    // - Head elements (title, meta, link, script, style, etc.)
    const excludedElements = new Set([
      "Fragment",
      "React.Fragment",
      "Html",
      "Head",
      "body",
      "Main",
      "NextScript",
      "html",
      "head",
      "title",
      "meta",
      "link",
      "script",
      "style",
      "base",
      "noscript",
    ]);

    walk(ast.program, {
      enter(node) {
        if (node.type !== "JSXOpeningElement") {
          return;
        }

        try {
          let elementName;
          if (node.name.type === "JSXIdentifier") {
            elementName = node.name.name;
          } else if (node.name.type === "JSXMemberExpression") {
            const object = node.name.object.name;
            const property = node.name.property.name;
            elementName = `${object}.${property}`;
          } else if (node.name.type === "JSXNamespacedName") {
            elementName = `${node.name.namespace.name}:${node.name.name.name}`;
          } else {
            return;
          }

          if (excludedElements.has(elementName)) {
            return;
          }

          const tagStart = node.start;
          const tagEnd = node.end;
          const tagSource = source.substring(tagStart, tagEnd);
          if (tagSource.includes("data-sg-el=")) {
            return;
          }

          const line = node.loc.start.line;
          const column = node.loc.start.column;

          const dataSgEl = `${filePath}:${line}:${column}`;
          const attributesString = ` data-sg-el="${dataSgEl}" data-sg-name="${elementName}"`;

          // Example: <Button> becomes <Button data-sg-el="..." data-sg-name="...">
          const insertPosition = node.name.end;
          magicString.appendLeft(insertPosition, attributesString);

          insertCount++;
        } catch (elementError) {
          errorCount++;

          console.warn(
            `[Softgen Element Tagger] Failed to tag element in ${filePath}:`,
            elementError.message
          );
        }
      },
    });

    return magicString.toString();
  } catch (error) {
    console.error(
      `[Softgen Element Tagger] Critical error processing ${filePath}:`,
      error.message
    );
    return source;
  }
}
