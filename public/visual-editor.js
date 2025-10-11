(function () {
  "use strict";

  const MESSAGE_TYPES = {
    // Messages from iframe to platform (events only)
    READY: "READY",
    ELEMENT_CLICKED: "ELEMENT_CLICKED",
    INLINE_EDIT_STATE: "INLINE_EDIT_STATE",
    ELEMENT_TEXT_UPDATED: "ELEMENT_TEXT_UPDATED",
    OPEN_EDITOR_POPOVER: "OPEN_EDITOR_POPOVER",
    SELECTION_CLEARED: "SELECTION_CLEARED",

    // Messages from platform to iframe (commands only)
    SET_STATE: "SET_STATE",
    UPDATE_TEXT_CONTENT: "UPDATE_TEXT_CONTENT",
    UPDATE_STYLES: "UPDATE_STYLES",
    UPDATE_CLASSES: "UPDATE_CLASSES",
    DELETE_ELEMENT: "DELETE_ELEMENT",
    CLEAR_SELECTION: "CLEAR_SELECTION",
  };

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

  const TEXT_TAGS = /^(h[1-6]|p|span|button|a|label|li|strong|em|b|i|u)$/;

  let isEditModeEnabled = false;
  let isSavingInProgress = false;
  let selectedElement = null;
  let editingElement = null;
  let originalText = "";
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

    el.setAttribute("data-sg-editing", "true");
    el.setAttribute("contenteditable", "true");
    el.focus();

    const handleBlur = () => {
      stopInlineEditing(true);
    };

    const handleInput = () => {
      sendMessage(MESSAGE_TYPES.ELEMENT_TEXT_UPDATED, {
        text: el.textContent || "",
        metadata: parseElementLocation(el),
      });
    };

    el.addEventListener("blur", handleBlur);
    el.addEventListener("input", handleInput);

    el._sgEditorHandlers = { handleBlur, handleInput };

    sendMessage(MESSAGE_TYPES.INLINE_EDIT_STATE, {
      state: "started",
      ...buildElementPayload(el, false),
    });

    sendMessage(
      MESSAGE_TYPES.OPEN_EDITOR_POPOVER,
      buildElementPayload(el, true)
    );
  }

  function stopInlineEditing(save) {
    if (!editingElement) return;

    const el = editingElement;
    const newText = el.textContent || "";
    const metadata = parseElementLocation(el);

    if (!save) {
      el.textContent = originalText;
    }

    el.removeAttribute("contenteditable");
    el.removeAttribute("data-sg-editing");

    if (el._sgEditorHandlers) {
      el.removeEventListener("blur", el._sgEditorHandlers.handleBlur);
      el.removeEventListener("input", el._sgEditorHandlers.handleInput);
      delete el._sgEditorHandlers;
    }

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

  function isPreformatted(el) {
    const tagName = el.tagName.toLowerCase();

    // Code/pre elements are always pre-formatted
    if (tagName === "code" || tagName === "pre") {
      return true;
    }

    const whiteSpace = window.getComputedStyle(el).whiteSpace;
    return (
      whiteSpace === "pre" ||
      whiteSpace === "pre-line" ||
      whiteSpace === "pre-wrap"
    );
  }

  function checkEditability(el) {
    const tagName = el.tagName.toLowerCase();

    // Pre-formatted elements are non-editable
    if (isPreformatted(el)) {
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
    // Pre-formatted elements: preserve exact whitespace
    if (isPreformatted(el)) {
      return el.textContent || "";
    }

    // Normal elements: use innerText (respects CSS display) and trim
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
        tagName: tagName,
        textContent: getTextContent(el),
        className: el.className || "",
      },
      isTextEditable: editabilityCheck.isTextEditable,
      canEditStyles: editabilityCheck.canEditStyles,
    };

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
    if (!isEditModeEnabled) return;

    e.preventDefault();
    e.stopPropagation();

    const el = findTrackedElement(e.target);

    if (selectedElement) {
      clearElementHighlight(selectedElement, "select");
    }

    if (el) {
      const editCheck = checkEditability(el);

      if (!editCheck.isTextEditable && !editCheck.canEditStyles) {
        return;
      }

      const isTextElement =
        editCheck.isTextEditable && hasDirectTextContent(el);

      selectedElement = el;

      el.setAttribute("data-sg-selected", "true");

      sendMessage(MESSAGE_TYPES.ELEMENT_CLICKED, buildElementPayload(el, true));

      if (isTextElement) {
        startInlineEditing(el);
      }
    } else {
      selectedElement = null;
      sendMessage(MESSAGE_TYPES.ELEMENT_CLICKED, null);
    }
  }

  function onKeyDown(e) {
    if (!isEditModeEnabled) return;

    if (e.key === "Escape") {
      if (editingElement) {
        return;
      }

      if (selectedElement) {
        clearElementHighlight(selectedElement, "select");
        selectedElement = null;
      }

      sendMessage(MESSAGE_TYPES.SELECTION_CLEARED, {});
    }
  }

  function blockInteraction(e) {
    if (e.target.hasAttribute && e.target.hasAttribute("data-sg-editing")) {
      return;
    }

    // Check if this is a tracked element (walk up DOM tree like onClick does)
    const trackedElement = findTrackedElement(e.target);
    if (trackedElement) {
      // This is our tracked element - don't block it!
      // But still prevent default behavior for links/buttons to avoid navigation/submission
      const tagName = trackedElement.tagName.toLowerCase();
      if (tagName === "a" || tagName === "button") {
        e.preventDefault();
      }
      return;
    }

    // Not our element - block everything
    const tagName = e.target.tagName?.toLowerCase();

    const shouldBlock =
      e.type === "submit" ||
      (e.type === "click" && (tagName === "a" || tagName === "button"));

    if (shouldBlock) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }

  function registerEventHandlers() {
    // Block interactions (prevent form submissions, link navigation, etc.)
    document.addEventListener("submit", blockInteraction, true);
    document.addEventListener("click", blockInteraction, true);

    // Visual editor interactions (hover handled by pure CSS!)
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
  }

  function unregisterEventHandlers() {
    document.removeEventListener("submit", blockInteraction, true);
    document.removeEventListener("click", blockInteraction, true);

    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function enable() {
    console.debug("[Visual Editor] Enabling edit mode");

    injectStyles();

    registerEventHandlers();
    document.body.style.cursor = "crosshair";

    const scrollStyle = document.createElement("style");
    scrollStyle.id = "sg-scroll-override";
    scrollStyle.textContent = "* { scroll-behavior: auto !important; }";
    document.head.appendChild(scrollStyle);
  }

  function disable() {
    console.debug("[Visual Editor] Disabling edit mode");

    stopInlineEditing(false);

    unregisterEventHandlers();
    document.body.style.cursor = "";
    document.body.removeAttribute("data-sg-saving");

    if (selectedElement) {
      clearElementHighlight(selectedElement, "select");
    }

    selectedElement = null;

    removeStyles();

    document.getElementById("sg-scroll-override")?.remove();
  }

  const messageHandlers = {
    [MESSAGE_TYPES.SET_STATE]: (payload) => {
      const newState = payload?.state;

      if (!["disabled", "enabled", "saving"].includes(newState)) {
        console.error("[Visual Editor] Invalid state:", newState);
        return;
      }

      console.debug(`[Visual Editor] Command: SET_STATE → ${newState}`);

      if (newState === "enabled") {
        if (!isEditModeEnabled) {
          enable();
          isEditModeEnabled = true;
        }

        if (isSavingInProgress) {
          document.body.removeAttribute("data-sg-saving");
          isSavingInProgress = false;
        }
      } else if (newState === "disabled") {
        disable();
        isEditModeEnabled = false;
        isSavingInProgress = false;
      } else if (newState === "saving") {
        document.body.setAttribute("data-sg-saving", "true");
        isSavingInProgress = true;

        stopInlineEditing(false);

        if (selectedElement) {
          clearElementHighlight(selectedElement, "select");
          selectedElement = null;
        }
      }
    },

    [MESSAGE_TYPES.UPDATE_TEXT_CONTENT]: (payload) => {
      if (!selectedElement) {
        console.warn("[Visual Editor] No element selected for text update");
        return;
      }

      if (payload?.text !== undefined) {
        selectedElement.textContent = payload.text;
      }
    },

    [MESSAGE_TYPES.UPDATE_STYLES]: (payload) => {
      if (!selectedElement) {
        console.warn("[Visual Editor] No element selected for style update");
        return;
      }

      if (!payload || typeof payload !== "object") {
        console.error("[Visual Editor] Invalid styles payload:", payload);
        return;
      }

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

      if (payload.remove && Array.isArray(payload.remove)) {
        payload.remove.forEach((cls) => {
          if (cls && typeof cls === "string") {
            selectedElement.classList.remove(cls);
          }
        });
      }

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
      if (selectedElement && selectedElement.parentNode) {
        console.debug("[Visual Editor] Deleting selected element from DOM");
        selectedElement.parentNode.removeChild(selectedElement);
        selectedElement = null;
      }
    },

    [MESSAGE_TYPES.CLEAR_SELECTION]: () => {
      stopInlineEditing(false);

      if (selectedElement) {
        clearElementHighlight(selectedElement, "select");
        selectedElement = null;
      }

      sendMessage(MESSAGE_TYPES.SELECTION_CLEARED, {});
    },
  };

  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.source !== "softgen-editor") return;
    if (e.source !== window.parent) return;

    const { type, payload } = e.data;

    const handler = messageHandlers[type];
    if (handler) {
      handler(payload);
    } else {
      console.warn("[Visual Editor] Unknown message type:", type);
    }
  });

  function init() {
    const ready = () => {
      // Check if there are any tagged elements on the page
      const taggedElements = document.querySelectorAll("[data-sg-el]");

      if (taggedElements.length === 0) {
        console.debug(
          "[Visual Editor] No tagged elements found on page. Editor will not initialize."
        );
        return;
      }

      console.debug(
        `[Visual Editor] Found ${taggedElements.length} tagged element(s). Ready to initialize.`
      );

      sendMessage(MESSAGE_TYPES.READY, {
        url: window.location.href,
        timestamp: new Date().toISOString(),
        taggedElementsCount: taggedElements.length,
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
