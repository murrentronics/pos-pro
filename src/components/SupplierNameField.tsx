import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listSupplierNames, rememberSupplier } from "@/lib/suppliers";

export function SupplierNameField({
  ownerId,
  value,
  onChange,
  placeholder = "Select supplier",
}: {
  ownerId: string;
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [entering, setEntering] = useState(false);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ownerId) return;
    listSupplierNames(ownerId).then(setNames);
  }, [ownerId]);

  const options = value && !names.some((n) => n.toLowerCase() === value.toLowerCase())
    ? [value, ...names]
    : names;

  const selected = options.find((n) => n.toLowerCase() === value.trim().toLowerCase()) ?? "";

  const placeMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rows = options.length + 1;
    const menuHeight = Math.min(240, rows * 36 + 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight && rect.top > spaceBelow
      ? Math.max(8, rect.top - menuHeight - 4)
      : rect.bottom + 4;
    setMenuPos({ top, left: rect.left, width: rect.width });
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const commit = async () => {
    const next = draft.trim();
    if (!next) return;
    await rememberSupplier(ownerId, next);
    setNames((prev) =>
      prev.some((n) => n.toLowerCase() === next.toLowerCase())
        ? prev
        : [...prev, next].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    );
    onChange(next);
    setDraft("");
    setEntering(false);
  };

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            placeMenu();
            setOpen(true);
          }}
          className="min-w-0 flex-1 h-10 rounded-xl border border-border bg-muted px-3 text-sm font-bold text-left outline-none focus:ring-1 focus:ring-primary"
        >
          <span className={selected ? "text-foreground" : "text-muted-foreground"}>
            {selected || placeholder}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setEntering((v) => !v)}
          className="h-10 px-3 rounded-xl text-xs font-black shrink-0"
          style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
        >
          Enter new
        </button>
      </div>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] max-h-60 overflow-y-auto rounded-lg border border-black/10 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width, overscrollBehavior: "contain", touchAction: "pan-y" }}
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <MenuRow
            label={placeholder}
            active={selected === ""}
            onPick={() => pick("")}
          />
          {options.map((name) => (
            <MenuRow
              key={name}
              label={name}
              active={name.toLowerCase() === selected.toLowerCase()}
              onPick={() => pick(name)}
            />
          ))}
        </div>,
        document.body,
      )}
      {entering && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              }
            }}
            placeholder="New supplier name"
            className="min-w-0 flex-1 h-10 rounded-xl border border-border bg-muted px-3 text-sm font-bold outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => void commit()}
            className="h-10 px-3 rounded-xl text-xs font-black bg-muted"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function MenuRow({
  label,
  active,
  onPick,
}: {
  label: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="block w-full px-3 py-2 text-left text-sm text-gray-900"
      style={{ background: active ? "#dbeafe" : "transparent" }}
    >
      {label}
    </button>
  );
}
