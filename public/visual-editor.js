// Visual Editor Iframe Script - Minimal Bridge
(function () {
  "use strict";

  const ALLOWED_ORIGINS = ["*"];

  // Message type constants (prevent typos and improve maintainability)
  const MESSAGE_TYPES = {
    // Messages from iframe to platform
    ELEMENT_HOVERED: "ELEMENT_HOVERED",
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
    UPDATE_COMPONENT: "UPDATE_COMPONENT",
    DELETE_ELEMENT: "DELETE_ELEMENT",
    CLEAR_SELECTION: "CLEAR_SELECTION",
  };

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
      /* Hover state - Blue dashed outline with background (only for unselected elements) */
      [data-sg-hovered]:not([data-sg-selected]) {
        outline: 2px dashed rgba(93,208,220) !important;
        outline-offset: 2px !important;
        background-color: rgba(93,208,220, 0.05) !important;
        cursor: pointer !important;
        transition: outline 0.15s ease !important;
      }

      /* Selected state - Same dashed outline, NO background (clean) */
      [data-sg-selected] {
        outline: 2px dashed rgba(93,208,220) !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        transition: outline 0.15s ease !important;
      }

      /* Hover on selected element - add background back */
      [data-sg-selected][data-sg-hovered] {
        background-color: rgba(93,208,220, 0.05) !important;
      }

      /* Full-width elements - Inset outline */
      [data-sg-hovered][data-sg-full-width]:not([data-sg-selected]),
      [data-sg-selected][data-sg-full-width] {
        outline-offset: -2px !important;
      }

      /* Inline editing state - text cursor + no native outline */
      [data-sg-editing] {
        cursor: text !important;
        outline: none !important;
        /* Keep our custom visual indicator (overrides selection outline) */
        box-shadow: 0 0 0 2px rgba(93,208,220) !important;
        background-color: rgba(93,208,220, 0.05) !important;
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
        metadata: getMetadata(el),
      });
    };

    el.addEventListener("blur", handleBlur);
    el.addEventListener("input", handleInput);

    // Store handlers for cleanup
    el._sgEditorHandlers = { handleBlur, handleInput };

    sendMessage(MESSAGE_TYPES.INLINE_EDIT_STARTED, buildPayload(el, false));

    // Open editor popover when editing starts
    sendMessage(MESSAGE_TYPES.OPEN_EDITOR_POPOVER, buildPayload(el, true));
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
        metadata: getMetadata(el),
        changed: true,
      });
    } else {
      sendMessage(MESSAGE_TYPES.INLINE_EDIT_CANCELLED, {
        text: originalText,
        metadata: getMetadata(el),
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

  // Parse data-sg-el: "file:line:col" → {id, filePath, line, column}
  function getMetadata(el) {
    const id = el.getAttribute("data-sg-el");
    if (!id) return null;

    const match = id.match(/^(.+):(\d+):(\d+)$/);
    if (!match) return null;

    return {
      id,
      filePath: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
    };
  }

  // Check if element should be editable
  // Returns: { isEditable: boolean, reason: string }
  // Note: We only tag specific safe elements in the loader, so most edge cases
  // are already filtered out. This checks runtime conditions only.
  function checkEditability(el) {
    const tagName = el.tagName.toLowerCase();
    const computedStyle = window.getComputedStyle(el);

    // Check for preserved whitespace (CSS can be dynamic)
    const whiteSpace = computedStyle.whiteSpace;
    if (
      whiteSpace === "pre" ||
      whiteSpace === "pre-line" ||
      whiteSpace === "pre-wrap"
    ) {
      return {
        isEditable: false,
      };
    }

    // Check for <code> nested inside tagged element (e.g., <p><code>x</code></p>)
    if (tagName === "code" || el.querySelector("code")) {
      return {
        isEditable: false,
      };
    }

    // All tagged elements are editable by default
    // (loader already filtered to safe list: p, span, h1-h6, button, a, label)
    return {
      isEditable: true,
    };
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

  // Find closest element with data-sg-el
  function findTrackedElement(target) {
    let el = target;
    while (el && el !== document.body) {
      if (el.hasAttribute?.("data-sg-el")) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Build payload with element data (read from DOM - WYSIWYG principle)
  function buildPayload(el, includeStyles) {
    const rect = el.getBoundingClientRect();
    const meta = getMetadata(el);
    const editabilityCheck = checkEditability(el);

    const payload = {
      componentPath: meta?.filePath || "",
      line: meta?.line || 0,
      column: meta?.column || 0,
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
      // Editability metadata (simple, focused check)
      isEditable: editabilityCheck.isEditable,
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
        color: style.color,
        backgroundColor: style.backgroundColor,
      };
    }

    return payload;
  }

  // Event: Mouse over (simple hover for unselected elements)
  function onMouseOver(e) {
    if (!isEditModeEnabled) return;

    const el = findTrackedElement(e.target);
    if (!el || el === hoveredElement || el === selectedElement) return;

    // Clear previous hover
    if (hoveredElement && hoveredElement !== selectedElement) {
      hoveredElement.removeAttribute("data-sg-hovered");
      hoveredElement.removeAttribute("data-sg-full-width");
    }

    hoveredElement = el;

    // Don't apply hover to selected element
    if (el === selectedElement) return;

    // Apply hover highlight
    el.setAttribute("data-sg-hovered", "true");

    // Detect full-width layout
    const rect = el.getBoundingClientRect();
    if (Math.abs(rect.width - window.innerWidth) < 5) {
      el.setAttribute("data-sg-full-width", "true");
    }
  }

  // Event: Click (BEST UX - instant editing for text, selection for others)
  function onClick(e) {
    if (!isEditModeEnabled) return;

    e.preventDefault();
    e.stopPropagation();

    const el = findTrackedElement(e.target);

    // Clear previous selection
    if (selectedElement) {
      selectedElement.removeAttribute("data-sg-selected");
      selectedElement.removeAttribute("data-sg-full-width");
    }

    // Clear hover state
    if (hoveredElement) {
      hoveredElement.removeAttribute("data-sg-hovered");
      hoveredElement.removeAttribute("data-sg-full-width");
    }

    if (el) {
      // Check editability before selecting
      const editCheck = checkEditability(el);

      if (!editCheck.isEditable) {
        return;
      }

      // Check if it's a text element
      const tagName = el.tagName.toLowerCase();
      const textElements = [
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
      const isTextElement = textElements.includes(tagName);

      selectedElement = el;
      hoveredElement = null;

      // Always show selection highlight
      el.setAttribute("data-sg-selected", "true");

      // Detect full-width layout
      const rect = el.getBoundingClientRect();
      if (Math.abs(rect.width - window.innerWidth) < 5) {
        el.setAttribute("data-sg-full-width", "true");
      }

      // Send click event first
      sendMessage(MESSAGE_TYPES.ELEMENT_CLICKED, buildPayload(el, true));

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
        selectedElement.removeAttribute("data-sg-selected");
        selectedElement.removeAttribute("data-sg-full-width");
        selectedElement = null;
      }

      // Priority 3: Clear hover
      if (hoveredElement) {
        hoveredElement.removeAttribute("data-sg-hovered");
        hoveredElement.removeAttribute("data-sg-full-width");
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
      hoveredElement.removeAttribute("data-sg-hovered");
      hoveredElement.removeAttribute("data-sg-full-width");
      hoveredElement = null;
    }
  }

  // Block interactions during edit mode
  function blockInteraction(e) {
    // Allow our own elements
    if (e.target.hasAttribute && e.target.hasAttribute("data-sg-editing")) {
      return; // Allow editing
    }

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

    // Block button clicks (unless it's our element)
    if (
      tagName === "button" &&
      e.type === "click" &&
      !e.target.hasAttribute("data-sg-el")
    ) {
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
      hoveredElement.removeAttribute("data-sg-hovered");
      hoveredElement.removeAttribute("data-sg-full-width");
    }
    if (selectedElement) {
      selectedElement.removeAttribute("data-sg-selected");
      selectedElement.removeAttribute("data-sg-full-width");
    }

    hoveredElement = null;
    selectedElement = null;

    // Remove CSS styles
    removeStyles();

    // Re-enable smooth scrolling
    document.getElementById("sg-scroll-override")?.remove();

    sendMessage(MESSAGE_TYPES.EDIT_MODE_DISABLED, { enabled: false });
  }

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

    switch (type) {
      case MESSAGE_TYPES.ENABLE_EDIT_MODE:
        enable();
        break;
      case MESSAGE_TYPES.DISABLE_EDIT_MODE:
        disable();
        break;
      case MESSAGE_TYPES.UPDATE_COMPONENT:
        // Real-time updates: update selected element text
        if (selectedElement && payload?.newProps?.children !== undefined) {
          selectedElement.textContent = payload.newProps.children;
        }
        break;
      case MESSAGE_TYPES.DELETE_ELEMENT:
        // Delete the selected element from DOM
        if (selectedElement && selectedElement.parentNode) {
          console.log('[Visual Editor] Deleting selected element from DOM');
          selectedElement.parentNode.removeChild(selectedElement);
          selectedElement = null;
          hoveredElement = null;
        }
        break;
      case MESSAGE_TYPES.CLEAR_SELECTION:
        // Stop any inline editing
        stopInlineEditing(false);

        // Clear selection highlight
        if (selectedElement) {
          selectedElement.removeAttribute("data-sg-selected");
          selectedElement.removeAttribute("data-sg-full-width");
          selectedElement = null;
        }
        // Clear hover highlight
        if (hoveredElement) {
          hoveredElement.removeAttribute("data-sg-hovered");
          hoveredElement.removeAttribute("data-sg-full-width");
          hoveredElement = null;
        }
        sendMessage(MESSAGE_TYPES.SELECTION_CLEARED, {});
        break;
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
