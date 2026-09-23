import { useEffect, useRef } from "react";

/**
 * Maps the PC keyboard (top-row and numpad) onto an on-screen numpad.
 *
 * Digit keys → "0"–"9"
 * `.` `,` NumpadDecimal → "."
 * Backspace / Delete → "⌫"
 * Enter / NumpadEnter → onEnter (OK / Proceed / Done)
 */
export function useNumpadKeyboard(options: {
  enabled: boolean;
  onKey: (key: string) => void;
  onEnter?: () => void;
  allowDecimal?: boolean;
}) {
  const { enabled, onKey, onEnter, allowDecimal = true } = options;
  const onKeyRef = useRef(onKey);
  const onEnterRef = useRef(onEnter);
  onKeyRef.current = onKey;
  onEnterRef.current = onEnter;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      if (e.key === "Enter") {
        if (!onEnterRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onEnterRef.current();
        return;
      }

      let mapped: string | null = null;
      if (e.key >= "0" && e.key <= "9") mapped = e.key;
      else if (e.key === "." || e.key === "," || e.code === "NumpadDecimal") {
        mapped = allowDecimal ? "." : null;
      } else if (e.key === "Backspace" || e.key === "Delete") {
        mapped = "⌫";
      }

      if (!mapped) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onKeyRef.current(mapped);
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled, allowDecimal]);
}

/** Shared money-amount key logic: digits, one decimal, 2 places, backspace. */
export function applyMoneyKey(current: string, k: string): string {
  if (k === "⌫") return current.slice(0, -1);
  if (k === ".") return current.includes(".") ? current : current + ".";
  const dotIdx = current.indexOf(".");
  if (dotIdx !== -1 && current.length - dotIdx > 2) return current;
  return current === "0" ? k : current + k;
}

/** Integer-only key logic. */
export function applyIntKey(current: string, k: string): string {
  if (k === "⌫") return current.slice(0, -1);
  if (k === ".") return current;
  return current === "0" || current === "" ? k : current + k;
}
