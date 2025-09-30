// Visual Editor Iframe Script - Minimal Bridge
(function () {
  "use strict";

  const ALLOWED_ORIGINS = ["*"];

  let isEditModeEnabled = false;
  let hoveredElement = null;
  let selectedElement = null;

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
    const content = el.getAttribute("data-component-content");

    if (!id) return null;

    const match = id.match(/^(.+):(\d+):(\d+)$/);
    if (!match) return null;

    return {
      id,
      filePath: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      content: content || ""
    };
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

  // Build payload with element data
  function buildPayload(el, includeStyles) {
    const rect = el.getBoundingClientRect();
    const meta = getMetadata(el);

    const payload = {
      componentPath: meta?.filePath || "",
      line: meta?.line || 0,
      column: meta?.column || 0,
      element: {
        tagName: el.tagName.toLowerCase(),
        className: el.className || "",
        id: el.id || "",
        textContent: meta?.content || el.textContent?.trim() || ""
      },
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom
      }
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
        backgroundColor: style.backgroundColor
      };
    }

    return payload;
  }

  // Event: Mouse over
  function onMouseOver(e) {
    if (!isEditModeEnabled) return;

    const el = findTrackedElement(e.target);
    if (el && el !== hoveredElement) {
      hoveredElement = el;
      sendMessage("ELEMENT_HOVERED", buildPayload(el, false)); // No styles for hover
    }
  }

  // Event: Mouse out
  function onMouseOut(e) {
    if (!isEditModeEnabled) return;
    if (e.target === hoveredElement) {
      hoveredElement = null;
    }
  }

  // Event: Click
  function onClick(e) {
    if (!isEditModeEnabled) return;

    e.preventDefault();
    e.stopPropagation();

    const el = findTrackedElement(e.target);
    if (el) {
      selectedElement = el;
      sendMessage("ELEMENT_CLICKED", buildPayload(el, true)); // Include styles for editing
    } else {
      selectedElement = null;
      sendMessage("ELEMENT_CLICKED", null);
    }
  }

  // Enable edit mode
  function enable() {
    if (isEditModeEnabled) return;
    isEditModeEnabled = true;

    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("click", onClick, true);
    document.body.style.cursor = "crosshair";

    sendMessage("EDIT_MODE_ENABLED", { enabled: true });
  }

  // Disable edit mode
  function disable() {
    if (!isEditModeEnabled) return;
    isEditModeEnabled = false;

    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("click", onClick, true);
    document.body.style.cursor = "";

    hoveredElement = null;
    selectedElement = null;

    sendMessage("EDIT_MODE_DISABLED", { enabled: false });
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
      case "ENABLE_EDIT_MODE":
        enable();
        break;
      case "DISABLE_EDIT_MODE":
        disable();
        break;
      case "UPDATE_COMPONENT":
        // Real-time updates: update selected element text
        if (selectedElement && payload?.newProps?.children !== undefined) {
          selectedElement.textContent = payload.newProps.children;
          sendMessage("COMPONENT_UPDATED", { success: true });
        }
        break;
      case "CLEAR_SELECTION":
        selectedElement = null;
        sendMessage("SELECTION_CLEARED", {});
        break;
      case "PING":
        sendMessage("PONG", { timestamp: Date.now() });
        break;
    }
  });

  // Send ready signal
  function init() {
    const ready = () => {
      sendMessage("EDIT_MODE_READY", {
        enabled: false,
        ready: true,
        url: window.location.href,
        timestamp: new Date().toISOString()
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
