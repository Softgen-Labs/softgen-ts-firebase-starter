(function () {
  "use strict";

  const MESSAGE_TYPES = {
    // Messages from iframe to platform
    READY: "READY",
    EDIT_MODE_STATE: "EDIT_MODE_STATE",
    ELEMENT_CLICKED: "ELEMENT_CLICKED",
    INLINE_EDIT_STATE: "INLINE_EDIT_STATE",
    ELEMENT_TEXT_UPDATED: "ELEMENT_TEXT_UPDATED",
    OPEN_EDITOR_POPOVER: "OPEN_EDITOR_POPOVER",
    SELECTION_CLEARED: "SELECTION_CLEARED",

    // Messages from platform to iframe
    SET_STATE: "SET_STATE",
    UPDATE_TEXT_CONTENT: "UPDATE_TEXT_CONTENT",
    UPDATE_STYLES: "UPDATE_STYLES",
    UPDATE_CLASSES: "UPDATE_CLASSES",
    DELETE_ELEMENT: "DELETE_ELEMENT",
    CLEAR_SELECTION: "CLEAR_SELECTION",
  };

  // CSS properties supported by platform editor
  const STYLE_PROPERTIES = [
    // Typography
    "fontSize",
    "fontWeight",
    "fontStyle",
    "textDecoration",
    "lineHeight",
    "textAlign",
    // Colors
    "color",
    "backgroundColor",
    // Spacing
    "margin",
    "padding",
    // Effects
    "borderRadius",
    "boxShadow",
    "opacity",
  ];

  // Simple text tag check - common inline/text elements
  const TEXT_TAGS = /^(h[1-6]|p|span|button|a|label|li|strong|em|b|i|u)$/;

  let editorState = "disabled"; // enabled | disabled | saving
  let selectedElement = null;
  let editingElement = null;
  let originalText = "";
  let originalInlineStyles = ""; // Store original inline styles to restore on cancel
  let styleElement = null;

  // Inject visual editor styles
  function injectStyles() {
    if (styleElement) return;

    styleElement = document.createElement("style");
    styleElement.id = "sg-visual-editor-styles";
    styleElement.textContent = `
      /* Hover state - Pure CSS :hover (no JavaScript needed!) */
      /* Only show hover when NOT in saving state and NOT already selected */
      body:not([data-sg-saving]) [data-sg-el]:hover:not([data-sg-selected]) {
        outline: 2px dashed rgba(93,208,220) !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        transition: outline 0.15s ease !important;
      }

      /* Remove hover from parent when child is hovered (only highlight innermost element) */
      body:not([data-sg-saving]) [data-sg-el]:has([data-sg-el]:hover):not([data-sg-selected]) {
        outline: none !important;
      }

      /* Selected state - Same dashed outline, clean and minimal */
      [data-sg-selected] {
        outline: 2px dashed rgba(93,208,220) !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        transition: outline 0.15s ease !important;
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

    sendMessage(MESSAGE_TYPES.INLINE_EDIT_STATE, {
      state: "started",
      ...buildElementPayload(el, false),
    });

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
    const metadata = parseElementLocation(el); // Cache metadata lookup

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

    // Send state message (saved or cancelled)
    const changed = save && newText !== originalText;
    sendMessage(MESSAGE_TYPES.INLINE_EDIT_STATE, {
      state: changed ? "saved" : "cancelled",
      text: changed ? newText : originalText,
      originalText: originalText,
      metadata: metadata,
      changed: changed,
    });

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

  function parseElementLocation(el) {
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

  function checkEditability(el) {
    const tagName = el.tagName.toLowerCase();

    // Code/pre elements are non-editable
    const isCodeOrPre = tagName === "code" || tagName === "pre";
    if (isCodeOrPre) {
      return { isTextEditable: false, canEditStyles: false };
    }

    // Check for pre-formatted whitespace
    const computedStyle = window.getComputedStyle(el);
    const whiteSpace = computedStyle.whiteSpace;
    if (
      whiteSpace === "pre" ||
      whiteSpace === "pre-line" ||
      whiteSpace === "pre-wrap"
    ) {
      return { isTextEditable: false, canEditStyles: false };
    }

    // Text tags can edit text, all others can only edit styles
    return {
      isTextEditable: TEXT_TAGS.test(tagName),
      canEditStyles: true,
    };
  }

  function hasDirectTextContent(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return true;
      }
    }
    return false;
  }

  function getTextContent(el) {
    const tagName = el.tagName.toLowerCase();

    // For pre/code elements, preserve whitespace
    if (tagName === "pre" || tagName === "code") {
      return el.textContent || "";
    }

    // Check for pre-formatted whitespace
    const whiteSpace = window.getComputedStyle(el).whiteSpace;
    if (
      whiteSpace === "pre" ||
      whiteSpace === "pre-line" ||
      whiteSpace === "pre-wrap"
    ) {
      return el.textContent || "";
    }

    return el.innerText?.trim() || "";
  }

  function clearElementHighlight(el, type = "all") {
    if (!el) return;

    const attributeMap = {
      select: ["data-sg-selected"],
      edit: ["data-sg-editing", "contenteditable"],
      all: ["data-sg-selected", "data-sg-editing", "contenteditable"],
    };

    const attrs = attributeMap[type] || attributeMap.all;
    attrs.forEach((attr) => el.removeAttribute(attr));
  }

  function findTrackedElement(target) {
    let el = target;
    while (el && el !== document.body) {
      if (el.hasAttribute?.("data-sg-el")) return el;
      el = el.parentElement;
    }
    return null;
  }

  function buildElementPayload(el, includeStyles) {
    const meta = parseElementLocation(el);
    const editabilityCheck = checkEditability(el);
    const tagName = el.tagName.toLowerCase(); // Cache tagName lookup

    const payload = {
      componentPath: meta?.filePath || "",
      line: meta?.line || 0,
      column: meta?.column || 0,
      componentName: el.getAttribute("data-sg-name") || tagName,
      element: {
        tagName: tagName, // Reuse cached tagName
        textContent: getTextContent(el), // Smart text extraction
      },
      // Editability metadata (clear distinction between text and style editing)
      isTextEditable: editabilityCheck.isTextEditable,
      canEditStyles: editabilityCheck.canEditStyles,
    };

    // Only include styles for click (selection), not hover
    if (includeStyles) {
      const style = window.getComputedStyle(el);
      payload.styles = {};
      STYLE_PROPERTIES.forEach((prop) => {
        payload.styles[prop] = style[prop];
      });
    }

    return payload;
  }

  function onClick(e) {
    // Only allow clicks in edit modes (enabled or saving)
    if (editorState === "disabled") return;

    e.preventDefault();
    e.stopPropagation();

    const el = findTrackedElement(e.target);

    // Clear previous selection and restore its original styles
    if (selectedElement) {
      clearElementHighlight(selectedElement, "select");
      // Restore original inline styles (remove any applied by platform)
      selectedElement.setAttribute("style", originalInlineStyles);
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
      // Store original inline styles before any editing
      originalInlineStyles = el.getAttribute("style") || "";

      // Always show selection highlight
      el.setAttribute("data-sg-selected", "true");

      // Send click event first
      sendMessage(MESSAGE_TYPES.ELEMENT_CLICKED, buildElementPayload(el, true));

      if (isTextElement) {
        // Text element: Start inline editing immediately (BEST UX!)
        // Selection highlight will remain visible under the editing state
        startInlineEditing(el);
      }
    } else {
      selectedElement = null;
      sendMessage(MESSAGE_TYPES.ELEMENT_CLICKED, null);
    }
  }

  function onKeyDown(e) {
    // Only allow ESC in edit modes (enabled or saving)
    if (editorState === "disabled") return;

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

      sendMessage(MESSAGE_TYPES.SELECTION_CLEARED, {});
    }
  }

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

    // Block interactive elements (links, buttons, forms)
    const shouldBlock =
      e.type === "submit" ||
      (e.type === "click" && (tagName === "a" || tagName === "button"));

    if (shouldBlock) {
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

    // Visual editor interactions (hover handled by pure CSS!)
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
  }

  function unregisterEventHandlers() {
    // Remove interaction blockers
    document.removeEventListener("submit", blockInteraction, true);
    document.removeEventListener("click", blockInteraction, true);

    // Remove visual editor interactions
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  // Enable edit mode (internal only - called by SET_STATE handler)
  function enable() {
    if (editorState !== "disabled") return;
    editorState = "enabled";
    console.debug("[Visual Editor] State: disabled → enabled");

    // Inject CSS styles
    injectStyles();

    // Register all event handlers using registry pattern
    registerEventHandlers();
    document.body.style.cursor = "crosshair";
    document.body.removeAttribute("data-sg-saving"); // Ensure clean state

    // Disable smooth scrolling
    const scrollStyle = document.createElement("style");
    scrollStyle.id = "sg-scroll-override";
    scrollStyle.textContent = "* { scroll-behavior: auto !important; }";
    document.head.appendChild(scrollStyle);
  }

  // Disable edit mode (internal only - called by SET_STATE handler)
  function disable() {
    if (editorState === "disabled") return;
    const previousState = editorState;
    editorState = "disabled";
    console.debug(`[Visual Editor] State: ${previousState} → disabled`);

    // Stop any inline editing
    stopInlineEditing(false);

    // Unregister all event handlers using registry pattern
    unregisterEventHandlers();
    document.body.style.cursor = "";
    document.body.removeAttribute("data-sg-saving"); // Clean up saving state

    // Clear selection highlight and restore original styles
    if (selectedElement) {
      clearElementHighlight(selectedElement, "select");
      // Restore original inline styles (clean up any applied changes)
      selectedElement.setAttribute("style", originalInlineStyles);
    }

    selectedElement = null;
    originalInlineStyles = "";

    // Remove CSS styles
    removeStyles();

    // Re-enable smooth scrolling
    document.getElementById("sg-scroll-override")?.remove();
  }

  // Message handlers - extracted for clarity and maintainability
  const messageHandlers = {
    [MESSAGE_TYPES.SET_STATE]: (payload) => {
      // Unified state transition handler
      const newState = payload?.state;

      if (!["disabled", "enabled", "saving"].includes(newState)) {
        console.error("[Visual Editor] Invalid state:", newState);
        return;
      }

      const previousState = editorState;

      // Ignore no-op transitions
      if (previousState === newState) {
        return;
      }

      console.debug(`[Visual Editor] State: ${previousState} → ${newState}`);

      // Handle transitions FROM old state (cleanup)
      if (previousState === "enabled" || previousState === "saving") {
        // Leaving edit mode entirely
        if (newState === "disabled") {
          disable();
          // Confirm state change to platform
          sendMessage(MESSAGE_TYPES.EDIT_MODE_STATE, { state: "disabled" });
          return; // disable() handles everything
        }
      }

      // Handle transitions TO new state (setup)
      if (newState === "enabled") {
        if (previousState === "disabled") {
          enable();
          // Confirm state change to platform
          sendMessage(MESSAGE_TYPES.EDIT_MODE_STATE, { state: "enabled" });
        } else if (previousState === "saving") {
          // Exit saving, stay in edit mode
          editorState = "enabled";
          document.body.removeAttribute("data-sg-saving");
          // Confirm state change to platform
          sendMessage(MESSAGE_TYPES.EDIT_MODE_STATE, { state: "enabled" });
        }
      } else if (newState === "saving") {
        if (previousState === "enabled") {
          // Enter saving from enabled
          editorState = "saving";
          document.body.setAttribute("data-sg-saving", "true");
          // No message needed - saving is internal state
        }
      } else if (newState === "disabled") {
        disable();
        // Confirm state change to platform
        sendMessage(MESSAGE_TYPES.EDIT_MODE_STATE, { state: "disabled" });
      }
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

      // Dynamically apply all style properties from payload
      Object.keys(payload).forEach((styleProp) => {
        if (payload[styleProp] !== undefined && payload[styleProp] !== null) {
          selectedElement.style[styleProp] = payload[styleProp];
        }
      });
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

      console.debug(
        "[Visual Editor] Updated className:",
        selectedElement.className
      );
    },

    [MESSAGE_TYPES.DELETE_ELEMENT]: () => {
      // Delete the selected element from DOM
      if (selectedElement && selectedElement.parentNode) {
        console.debug("[Visual Editor] Deleting selected element from DOM");
        selectedElement.parentNode.removeChild(selectedElement);
        selectedElement = null;
      }
    },

    [MESSAGE_TYPES.CLEAR_SELECTION]: () => {
      // Stop any inline editing
      stopInlineEditing(false);

      // Clear selection highlight and restore original styles
      if (selectedElement) {
        clearElementHighlight(selectedElement, "select");
        // Restore original inline styles (remove any applied by platform)
        selectedElement.setAttribute("style", originalInlineStyles);
        selectedElement = null;
      }

      sendMessage(MESSAGE_TYPES.SELECTION_CLEARED, {});
    },
  };

  // Listen for messages from platform
  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.source !== "softgen-editor") return;
    if (e.source !== window.parent) return;

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
      sendMessage(MESSAGE_TYPES.READY, {
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
