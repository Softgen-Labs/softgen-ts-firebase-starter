// Visual Editor Iframe Script - Minimal Bridge
(function () {
  "use strict";

  const ALLOWED_ORIGINS = ["*"];

  // Message type constants (prevent typos and improve maintainability)
  const MESSAGE_TYPES = {
    // Messages from iframe to platform
    ELEMENT_CLICKED: "ELEMENT_CLICKED",
    EDIT_MODE_READY: "EDIT_MODE_READY",
    EDIT_MODE_ENABLED: "EDIT_MODE_ENABLED",
    EDIT_MODE_DISABLED: "EDIT_MODE_DISABLED",
    INLINE_EDIT_STARTED: "INLINE_EDIT_STARTED",
    INLINE_EDIT_SAVED: "INLINE_EDIT_SAVED",
    INLINE_EDIT_CANCELLED: "INLINE_EDIT_CANCELLED",
    ELEMENT_TEXT_UPDATED: "ELEMENT_TEXT_UPDATED",
    OPEN_EDITOR_POPOVER: "OPEN_EDITOR_POPOVER",
    SELECTION_CLEARED: "SELECTION_CLEARED",

    // Messages from platform to iframe
    ENABLE_EDIT_MODE: "ENABLE_EDIT_MODE",
    DISABLE_EDIT_MODE: "DISABLE_EDIT_MODE",
    UPDATE_TEXT_CONTENT: "UPDATE_TEXT_CONTENT",
    UPDATE_STYLES: "UPDATE_STYLES",
    UPDATE_CLASSES: "UPDATE_CLASSES",
    DELETE_ELEMENT: "DELETE_ELEMENT",
    CLEAR_SELECTION: "CLEAR_SELECTION",
  };

  // Configuration constants
  const CONFIG = {
    FULL_WIDTH_THRESHOLD_PX: 5,
  };

  // Text elements that support inline editing (must have direct text content)
  const TEXT_ELEMENT_TAGS = new Set([
    // Headings
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    // Paragraphs and inline text
    "p",
    "span",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "small",
    "mark",
    "del",
    "ins",
    "sub",
    "sup",
    // Interactive text elements
    "button",
    "a",
    "label",
    // List items (contain direct text)
    "li",
    "dt",
    "dd",
    // Table cells (contain direct text)
    "td",
    "th",
    // Form text elements
    "legend",
    "figcaption",
    "caption",
    // Code elements
    "code",
    "kbd",
    "samp",
    "var",
    // Quotes
    "blockquote",
    "q",
    "cite",
  ]);

  // WeakMap cache for element metadata (auto-GC when element removed)
  // Caches parsed location and editability to avoid repeated calculations
  const elementMetadataCache = new WeakMap();

  let isEditModeEnabled = false;
  let hoveredElement = null;
  let selectedElement = null;
  let editingElement = null;
  let originalText = "";
  let styleElement = null;

  // Inject visual editor styles (CSS attribute selectors - clean and simple)
  function injectStyles() {
    if (styleElement) return;

    styleElement = document.createElement("style");
    styleElement.id = "sg-visual-editor-styles";
    styleElement.textContent = `
      /* Hover state - Blue dashed outline only (works for all elements including buttons) */
      [data-sg-hovered]:not([data-sg-selected]) {
        outline: 2px dashed rgba(93,208,220) !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        transition: outline 0.15s ease !important;
      }

      /* Selected state - Same dashed outline, clean and minimal */
      [data-sg-selected] {
        outline: 2px dashed rgba(93,208,220) !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        transition: outline 0.15s ease !important;
      }

      /* Full-width elements - Inset outline */
      [data-sg-hovered][data-sg-full-width]:not([data-sg-selected]),
      [data-sg-selected][data-sg-full-width] {
        outline-offset: -2px !important;
      }

      /* Inline editing state - text cursor + box shadow (no background to avoid conflicts) */
      [data-sg-editing] {
        cursor: text !important;
        outline: none !important;
        /* Solid box-shadow indicates editing mode */
        box-shadow: 0 0 0 2px rgba(93,208,220) !important;
      }

      /* Editing state takes visual precedence over selection */
      [data-sg-selected][data-sg-editing] {
        outline: none !important;
      }

      /* Remove native focus outline on contenteditable */
      [contenteditable="true"] {
        outline: none !important;
      }
    `;

    document.head.appendChild(styleElement);
  }

  // Remove visual editor styles
  function removeStyles() {
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
  }

  // Start inline text editing
  function startInlineEditing(el) {
    if (!el || editingElement === el) return;

    // Stop any existing edit
    stopInlineEditing(false);

    editingElement = el;
    originalText = el.textContent || "";

    // Apply editing state
    el.setAttribute("data-sg-editing", "true");
    el.setAttribute("contenteditable", "true");
    el.focus();

    const handleBlur = () => {
      // Save on blur (user clicked away)
      stopInlineEditing(true);
    };

    const handleInput = () => {
      // Send real-time updates
      sendMessage(MESSAGE_TYPES.ELEMENT_TEXT_UPDATED, {
        text: el.textContent || "",
        metadata: parseElementLocation(el),
      });
    };

    el.addEventListener("blur", handleBlur);
    el.addEventListener("input", handleInput);

    // Store handlers for cleanup
    el._sgEditorHandlers = { handleBlur, handleInput };

    sendMessage(
      MESSAGE_TYPES.INLINE_EDIT_STARTED,
      buildElementPayload(el, false)
    );

    // Open editor popover when editing starts
    sendMessage(
      MESSAGE_TYPES.OPEN_EDITOR_POPOVER,
      buildElementPayload(el, true)
    );
  }

  // Stop inline text editing
  function stopInlineEditing(save) {
    if (!editingElement) return;

    const el = editingElement;
    const newText = el.textContent || "";

    // Restore original if cancelled
    if (!save) {
      el.textContent = originalText;
    }

    // Remove contenteditable
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-sg-editing");

    // Remove event listeners
    if (el._sgEditorHandlers) {
      el.removeEventListener("blur", el._sgEditorHandlers.handleBlur);
      el.removeEventListener("input", el._sgEditorHandlers.handleInput);
      delete el._sgEditorHandlers;
    }

    // Send save message if changed
    if (save && newText !== originalText) {
      sendMessage(MESSAGE_TYPES.INLINE_EDIT_SAVED, {
        text: newText,
        originalText: originalText,
        metadata: parseElementLocation(el),
        changed: true,
      });
    } else {
      sendMessage(MESSAGE_TYPES.INLINE_EDIT_CANCELLED, {
        text: originalText,
        metadata: parseElementLocation(el),
        changed: false,
      });
    }

    editingElement = null;
    originalText = "";
  }

  // Send message to parent
  function sendMessage(type, payload) {
    try {
      window.parent.postMessage(
        { type, payload, source: "softgen-iframe" },
        "*"
      );
    } catch (e) {
      console.error("[Visual Editor] postMessage failed:", e);
    }
  }

  /**
   * Parse element location from data-sg-el attribute (with caching)
   * Format: "file:line:col" → {id, filePath, line, column}
   * @param {HTMLElement} el - Element with data-sg-el attribute
   * @returns {{id: string, filePath: string, line: number, column: number} | null}
   */
  function parseElementLocation(el) {
    // Check cache first (O(1) lookup)
    const cached = elementMetadataCache.get(el);
    if (cached && cached.location) {
      return cached.location;
    }

    const id = el.getAttribute("data-sg-el");
    if (!id) return null;

    const match = id.match(/^(.+):(\d+):(\d+)$/);
    if (!match) return null;

    const location = {
      id,
      filePath: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
    };

    // Cache for future lookups
    const metadata = cached || {};
    metadata.location = location;
    elementMetadataCache.set(el, metadata);

    return location;
  }

  /**
   * Check if element is editable (text and/or styles) - with caching
   * PHILOSOPHY: Restrictive allowlist - explicitly define what's safe to edit.
   * Better to start restrictive and allow more later than break layouts.
   * @param {HTMLElement} el - Element to check
   * @returns {{isTextEditable: boolean, canEditStyles: boolean}}
   */
  function checkEditability(el) {
    // Check cache first (O(1) lookup, avoids repeated style calculations)
    const cached = elementMetadataCache.get(el);
    if (cached && cached.editability) {
      return cached.editability;
    }

    const tagName = el.tagName.toLowerCase();
    const computedStyle = window.getComputedStyle(el);

    // Check for preserved whitespace (CSS can be dynamic)
    const whiteSpace = computedStyle.whiteSpace;
    if (
      whiteSpace === "pre" ||
      whiteSpace === "pre-line" ||
      whiteSpace === "pre-wrap"
    ) {
      const editability = {
        isTextEditable: false,
        canEditStyles: false, // Don't mess with code formatting
      };
      // Cache result
      const metadata = cached || {};
      metadata.editability = editability;
      elementMetadataCache.set(el, metadata);
      return editability;
    }

    // Check for <code>/<pre> elements (code blocks shouldn't be edited visually)
    if (tagName === "code" || tagName === "pre") {
      const editability = {
        isTextEditable: false,
        canEditStyles: false, // Don't mess with code formatting
      };
      // Cache result
      const metadata = cached || {};
      metadata.editability = editability;
      elementMetadataCache.set(el, metadata);
      return editability;
    }

    // ✅ EXPLICIT ALLOWLIST - Only these elements support text editing
    // This is the single source of truth (TEXT_ELEMENT_TAGS)
    const editability = TEXT_ELEMENT_TAGS.has(tagName)
      ? {
          isTextEditable: true,
          canEditStyles: true,
        }
      : {
          // Everything else: styles only (safe default for containers, custom components, etc.)
          // This includes: div, section, article, custom React components, etc.
          isTextEditable: false,
          canEditStyles: true, // Can still edit margins, padding, colors
        };

    // Cache result
    const metadata = cached || {};
    metadata.editability = editability;
    elementMetadataCache.set(el, metadata);

    return editability;
  }

  // Check if element has direct text content (not just nested in children)
  // This helps identify if an element is truly a "text element" vs a container
  function hasDirectTextContent(el) {
    // Check if element has any direct text nodes (not just whitespace)
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return true;
      }
    }
    return false;
  }

  // Get element text content intelligently
  // Uses innerText for WYSIWYG (normalized), textContent for preserved formatting
  function getTextContent(el) {
    const tagName = el.tagName.toLowerCase();
    const computedStyle = window.getComputedStyle(el);

    // For pre-formatted elements, use textContent (preserves whitespace)
    if (tagName === "pre" || tagName === "code") {
      return el.textContent || "";
    }

    const whiteSpace = computedStyle.whiteSpace;
    if (
      whiteSpace === "pre" ||
      whiteSpace === "pre-line" ||
      whiteSpace === "pre-wrap"
    ) {
      return el.textContent || "";
    }

    // For normal elements, use innerText (normalized, WYSIWYG)
    // This matches what the user sees in the browser
    return el.innerText?.trim() || "";
  }

  /**
   * Detect if element spans full viewport width
   * @param {HTMLElement} el - Element to check
   * @returns {boolean} True if element is full-width
   */
  function isFullWidth(el) {
    const rect = el.getBoundingClientRect();
    return (
      Math.abs(rect.width - window.innerWidth) < CONFIG.FULL_WIDTH_THRESHOLD_PX
    );
  }

  /**
   * Apply full-width attribute if needed
   * @param {HTMLElement} el - Element to check and update
   */
  function applyFullWidthAttribute(el) {
    if (isFullWidth(el)) {
      el.setAttribute("data-sg-full-width", "true");
    }
  }

  /**
   * Clear element visual state attributes
   * @param {HTMLElement} el - Element to clear
   * @param {string} type - Type of highlight to clear: 'hover', 'select', 'edit', or 'all'
   */
  function clearElementHighlight(el, type = "all") {
    if (!el) return;

    const attributeMap = {
      hover: ["data-sg-hovered", "data-sg-full-width"],
      select: ["data-sg-selected", "data-sg-full-width"],
      edit: ["data-sg-editing", "contenteditable"],
      all: [
        "data-sg-hovered",
        "data-sg-selected",
        "data-sg-editing",
        "data-sg-full-width",
        "contenteditable",
      ],
    };

    const attrs = attributeMap[type] || attributeMap.all;
    attrs.forEach((attr) => el.removeAttribute(attr));
  }

  /**
   * Find closest element with data-sg-el tracking attribute
   * @param {HTMLElement} target - Starting element
   * @returns {HTMLElement | null} Tracked element or null
   */
  function findTrackedElement(target) {
    let el = target;
    while (el && el !== document.body) {
      if (el.hasAttribute?.("data-sg-el")) return el;
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Build element payload with data for platform
   * @param {HTMLElement} el - Element to serialize
   * @param {boolean} includeStyles - Whether to include computed styles
   * @returns {Object} Element payload with location, properties, and optional styles
   */
  function buildElementPayload(el, includeStyles) {
    const rect = el.getBoundingClientRect();
    const meta = parseElementLocation(el);
    const editabilityCheck = checkEditability(el);

    const tagName = el.tagName.toLowerCase();
    const componentName = el.getAttribute("data-sg-name") || tagName;

    const payload = {
      componentPath: meta?.filePath || "",
      line: meta?.line || 0,
      column: meta?.column || 0,
      componentName,
      element: {
        tagName: el.tagName.toLowerCase(),
        className: el.className || "", // Read from DOM
        id: el.id || "",
        textContent: getTextContent(el), // Smart text extraction
        attributes: {
          // Include key attributes for display/editing
          href: el.getAttribute("href") || "",
          src: el.getAttribute("src") || "",
          alt: el.getAttribute("alt") || "",
          title: el.getAttribute("title") || "",
          placeholder: el.getAttribute("placeholder") || "",
        },
      },
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
      },
      // Editability metadata (clear distinction between text and style editing)
      isTextEditable: editabilityCheck.isTextEditable,
      canEditStyles: editabilityCheck.canEditStyles,
    };

    // Only include styles for click (selection), not hover
    if (includeStyles) {
      const style = window.getComputedStyle(el);
      payload.styles = {
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        textDecoration: style.textDecoration,
        lineHeight: style.lineHeight,
        color: style.color,
        backgroundColor: style.backgroundColor,
        textAlign: style.textAlign,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
      };
    }

    return payload;
  }

  // Event: Mouse over (simple hover for unselected elements)
  function onMouseOver(e) {
    if (!isEditModeEnabled) return;

    const el = findTrackedElement(e.target);
    if (!el || el === hoveredElement || el === selectedElement) return;

    // Check if element is editable BEFORE showing hover
    const editCheck = checkEditability(el);
    if (!editCheck.isTextEditable && !editCheck.canEditStyles) {
      // Clear any previous hover and don't hover non-editable elements
      if (hoveredElement && hoveredElement !== selectedElement) {
        clearElementHighlight(hoveredElement, "hover");
        hoveredElement = null;
      }
      return;
    }

    // Clear previous hover
    if (hoveredElement && hoveredElement !== selectedElement) {
      clearElementHighlight(hoveredElement, "hover");
    }

    hoveredElement = el;

    // Don't apply hover to selected element
    if (el === selectedElement) return;

    // Apply hover highlight
    el.setAttribute("data-sg-hovered", "true");
    applyFullWidthAttribute(el);
  }

  // Event: Click (BEST UX - instant editing for text, selection for others)
  function onClick(e) {
    if (!isEditModeEnabled) return;

    e.preventDefault();
    e.stopPropagation();

    const el = findTrackedElement(e.target);

    // Clear previous selection
    if (selectedElement) {
      clearElementHighlight(selectedElement, "select");
    }

    // Clear hover state
    if (hoveredElement) {
      clearElementHighlight(hoveredElement, "hover");
    }

    if (el) {
      // Check editability before selecting
      const editCheck = checkEditability(el);

      if (!editCheck.isTextEditable && !editCheck.canEditStyles) {
        return; // Can't edit text or styles
      }

      // Check if it's a text element with direct text content
      // Reuse editCheck.isTextEditable to avoid redundant checks
      const isTextElement =
        editCheck.isTextEditable && hasDirectTextContent(el);

      selectedElement = el;
      hoveredElement = null;

      // Always show selection highlight
      el.setAttribute("data-sg-selected", "true");
      applyFullWidthAttribute(el);

      // Send click event first
      sendMessage(MESSAGE_TYPES.ELEMENT_CLICKED, buildElementPayload(el, true));

      if (isTextElement) {
        // Text element: Start inline editing immediately (BEST UX!)
        // Selection highlight will remain visible under the editing state
        startInlineEditing(el);
      }
    } else {
      selectedElement = null;
      hoveredElement = null;
      sendMessage(MESSAGE_TYPES.ELEMENT_CLICKED, null);
    }
  }

  // Event: ESC key to clear selection or cancel editing
  function onKeyDown(e) {
    if (!isEditModeEnabled) return;

    if (e.key === "Escape") {
      // Priority 1: Stop inline editing if active (handled in startInlineEditing)
      if (editingElement) {
        // Let the editing handler deal with it
        return;
      }

      // Priority 2: Clear selection
      if (selectedElement) {
        clearElementHighlight(selectedElement, "select");
        selectedElement = null;
      }

      // Priority 3: Clear hover
      if (hoveredElement) {
        clearElementHighlight(hoveredElement, "hover");
        hoveredElement = null;
      }

      sendMessage(MESSAGE_TYPES.SELECTION_CLEARED, {});
    }
  }

  // Scroll handling - simplified (clear transient hover only)
  function onScroll() {
    if (!isEditModeEnabled) return;

    // Clear hover during scroll (transient UI)
    if (hoveredElement && hoveredElement !== selectedElement) {
      clearElementHighlight(hoveredElement, "hover");
      hoveredElement = null;
    }
  }

  // Block interactions during edit mode
  function blockInteraction(e) {
    // Allow our own editing elements
    if (e.target.hasAttribute && e.target.hasAttribute("data-sg-editing")) {
      return; // Allow editing
    }

    // Check if this is a tracked element (walk up DOM tree like onClick does)
    const trackedElement = findTrackedElement(e.target);
    if (trackedElement) {
      // This is our tracked element - don't block it!
      // But still prevent default behavior for links/buttons to avoid navigation/submission
      const tagName = trackedElement.tagName.toLowerCase();
      if (tagName === "a" || tagName === "button") {
        e.preventDefault(); // Prevent navigation/submission
        // Don't stop propagation - let onClick handle it
      }
      return;
    }

    // Not our element - block everything
    const tagName = e.target.tagName?.toLowerCase();

    // Block form submissions
    if (e.type === "submit") {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Block link navigation
    if (tagName === "a" && e.type === "click") {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Block button clicks
    if (tagName === "button" && e.type === "click") {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }

  // Event handler registry pattern (single source of truth)
  // Prevents bugs from forgotten cleanup and makes handlers easy to manage
  function registerEventHandlers() {
    // Block interactions (prevent form submissions, link navigation, etc.)
    document.addEventListener("submit", blockInteraction, true);
    document.addEventListener("click", blockInteraction, true);

    // Visual editor interactions
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function unregisterEventHandlers() {
    // Remove interaction blockers
    document.removeEventListener("submit", blockInteraction, true);
    document.removeEventListener("click", blockInteraction, true);

    // Remove visual editor interactions
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll);
  }

  // Enable edit mode
  function enable() {
    if (isEditModeEnabled) return;
    isEditModeEnabled = true;

    // Inject CSS styles
    injectStyles();

    // Register all event handlers using registry pattern
    registerEventHandlers();
    document.body.style.cursor = "crosshair";

    // Disable smooth scrolling
    const scrollStyle = document.createElement("style");
    scrollStyle.id = "sg-scroll-override";
    scrollStyle.textContent = "* { scroll-behavior: auto !important; }";
    document.head.appendChild(scrollStyle);

    sendMessage(MESSAGE_TYPES.EDIT_MODE_ENABLED, { enabled: true });
  }

  // Disable edit mode
  function disable() {
    if (!isEditModeEnabled) return;
    isEditModeEnabled = false;

    // Stop any inline editing
    stopInlineEditing(false);

    // Unregister all event handlers using registry pattern
    unregisterEventHandlers();
    document.body.style.cursor = "";

    // Clear all highlights
    if (hoveredElement) {
      clearElementHighlight(hoveredElement, "hover");
    }
    if (selectedElement) {
      clearElementHighlight(selectedElement, "select");
    }

    hoveredElement = null;
    selectedElement = null;

    // Remove CSS styles
    removeStyles();

    // Re-enable smooth scrolling
    document.getElementById("sg-scroll-override")?.remove();

    sendMessage(MESSAGE_TYPES.EDIT_MODE_DISABLED, { enabled: false });
  }

  // Message handlers - extracted for clarity and maintainability
  const messageHandlers = {
    [MESSAGE_TYPES.ENABLE_EDIT_MODE]: () => {
      enable();
    },

    [MESSAGE_TYPES.DISABLE_EDIT_MODE]: () => {
      disable();
    },

    [MESSAGE_TYPES.UPDATE_TEXT_CONTENT]: (payload) => {
      // Real-time text content updates
      if (!selectedElement) {
        console.warn("[Visual Editor] No element selected for text update");
        return;
      }

      if (payload?.text !== undefined) {
        selectedElement.textContent = payload.text;
      }
    },

    [MESSAGE_TYPES.UPDATE_STYLES]: (payload) => {
      // Real-time style updates (for native HTML elements only)
      if (!selectedElement) {
        console.warn("[Visual Editor] No element selected for style update");
        return;
      }

      if (!payload || typeof payload !== "object") {
        console.error("[Visual Editor] Invalid styles payload:", payload);
        return;
      }

      if (payload.fontSize) {
        selectedElement.style.fontSize = payload.fontSize;
      }
      if (payload.fontWeight) {
        selectedElement.style.fontWeight = payload.fontWeight;
      }
      if (payload.fontStyle) {
        selectedElement.style.fontStyle = payload.fontStyle;
      }
      if (payload.textDecoration) {
        selectedElement.style.textDecoration = payload.textDecoration;
      }
      if (payload.lineHeight) {
        selectedElement.style.lineHeight = payload.lineHeight;
      }
      if (payload.color) {
        selectedElement.style.color = payload.color;
      }
      if (payload.backgroundColor) {
        selectedElement.style.backgroundColor = payload.backgroundColor;
      }
      if (payload.textAlign) {
        selectedElement.style.textAlign = payload.textAlign;
      }
      if (payload.padding) {
        selectedElement.style.padding = payload.padding;
      }
      if (payload.margin) {
        selectedElement.style.margin = payload.margin;
      }
      if (payload.borderRadius) {
        selectedElement.style.borderRadius = payload.borderRadius;
      }
      if (payload.boxShadow) {
        selectedElement.style.boxShadow = payload.boxShadow;
      }
    },

    [MESSAGE_TYPES.UPDATE_CLASSES]: (payload) => {
      if (!selectedElement) {
        console.warn("[Visual Editor] No element selected for class update");
        return;
      }

      if (!payload || typeof payload !== "object") {
        console.error("[Visual Editor] Invalid classes payload:", payload);
        return;
      }

      // Remove specified classes
      if (payload.remove && Array.isArray(payload.remove)) {
        payload.remove.forEach((cls) => {
          if (cls && typeof cls === "string") {
            selectedElement.classList.remove(cls);
          }
        });
      }

      // Add new classes
      if (payload.add && Array.isArray(payload.add)) {
        payload.add.forEach((cls) => {
          if (cls && typeof cls === "string") {
            selectedElement.classList.add(cls);
          }
        });
      }

      console.debug("[Visual Editor] Updated className:", selectedElement.className);
    },

    [MESSAGE_TYPES.DELETE_ELEMENT]: () => {
      // Delete the selected element from DOM
      if (selectedElement && selectedElement.parentNode) {
        console.debug("[Visual Editor] Deleting selected element from DOM");
        selectedElement.parentNode.removeChild(selectedElement);
        selectedElement = null;
        hoveredElement = null;
      }
    },

    [MESSAGE_TYPES.CLEAR_SELECTION]: () => {
      // Stop any inline editing
      stopInlineEditing(false);

      // Clear selection highlight
      if (selectedElement) {
        clearElementHighlight(selectedElement, "select");
        selectedElement = null;
      }

      // Clear hover highlight
      if (hoveredElement) {
        clearElementHighlight(hoveredElement, "hover");
        hoveredElement = null;
      }

      sendMessage(MESSAGE_TYPES.SELECTION_CLEARED, {});
    },
  };

  // Listen for messages from platform
  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.source !== "softgen-editor") return;
    if (e.source !== window.parent) return;

    // Validate origin
    if (!ALLOWED_ORIGINS.includes("*") && !ALLOWED_ORIGINS.includes(e.origin)) {
      console.warn("[Visual Editor] Unauthorized origin:", e.origin);
      return;
    }

    const { type, payload } = e.data;

    // Execute handler if exists
    const handler = messageHandlers[type];
    if (handler) {
      handler(payload);
    } else {
      console.warn("[Visual Editor] Unknown message type:", type);
    }
  });

  // Send ready signal
  function init() {
    const ready = () => {
      sendMessage(MESSAGE_TYPES.EDIT_MODE_READY, {
        enabled: false,
        ready: true,
        url: window.location.href,
        timestamp: new Date().toISOString(),
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ready);
    } else {
      ready();
    }
  }

  init();
})();
