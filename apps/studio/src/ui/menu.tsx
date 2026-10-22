// A small pop-up menu in the macOS style, placed at a point and closed by
// Esc, a click elsewhere, or choosing an item.

import { useEffect, useRef } from "react";

export type MenuItem = { label: string; run: () => void; disabled?: boolean } | "separator";

export function Menu({ x, y, items, onClose, align = "left" }: { x: number; y: number; items: MenuItem[]; onClose: () => void; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = buttons[(at + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length];
        next?.focus();
      }
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", keys, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", keys, true);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 200);
  return (
    <div ref={ref} className="menu" role="menu" style={align === "right" ? { right: window.innerWidth - x, top: y } : { left, top: y }}>
      {items.map((item, index) =>
        item === "separator" ? (
          <hr key={index} />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
