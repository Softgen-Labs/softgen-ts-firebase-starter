import { parse } from "@babel/parser";
import { walk } from "estree-walker";
import MagicString from "magic-string";

export default function visualEditorLoader(source) {
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
    console.log("[Visual Editor Loader] Processing:", filePath);

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

    const excludedElements = new Set(["Fragment", "React.Fragment"]);

    let insertCount = 0;

    walk(ast.program, {
      enter(node) {
        if (node.type !== "JSXOpeningElement") {
          return;
        }

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

        // Check if already tagged (check source string)
        const tagStart = node.start;
        const tagEnd = node.end;
        const tagSource = source.substring(tagStart, tagEnd);
        if (tagSource.includes("data-sg-el=")) {
          return;
        }

        // Get location info
        const line = node.loc.start.line;
        const column = node.loc.start.column;

        // Create data attributes string
        const dataSgEl = `${filePath}:${line}:${column}`;
        const attributesString = ` data-sg-el="${dataSgEl}" data-sg-name="${elementName}"`;

        // Example: <Button> becomes <Button data-sg-el="..." data-sg-name="...">
        const insertPosition = node.name.end;
        magicString.appendLeft(insertPosition, attributesString);

        insertCount++;
      },
    });

    console.log(
      `[Visual Editor Loader] Tagged ${insertCount} elements in ${filePath}`
    );

    return magicString.toString();
  } catch (error) {
    console.error(
      `[Visual Editor Loader] Error processing ${filePath}:`,
      error.message
    );
    console.error(error.stack);
    return source;
  }
}
