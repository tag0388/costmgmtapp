"use client";

import { useEffect } from "react";

const SELECTOR = 'button[aria-label^="Open related records for "]';

export default function CostCodeActionPointerBridge() {
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      const button = target?.closest(SELECTOR) as HTMLButtonElement | null;
      if (!button || button.disabled) return;

      // AG Grid can consume the pointer sequence before React receives a normal
      // click from a custom cell renderer. Trigger the React click immediately
      // from the capture phase, before the grid handles row/cell selection.
      event.preventDefault();
      event.stopImmediatePropagation();
      button.click();
    }

    function onClick(event: MouseEvent) {
      if (!event.isTrusted) return;
      const target = event.target as Element | null;
      const button = target?.closest(SELECTOR);
      if (!button) return;

      // The pointer-down handler above already issued the synthetic click.
      // Swallow the browser's follow-up trusted click so the menu is not toggled twice.
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
