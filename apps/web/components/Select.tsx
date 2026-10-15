'use client';

import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary text shown on the right, e.g. "20 left". */
  detail?: string;
}

interface SelectProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}

/**
 * A dropdown whose list always opens BELOW the field. The native <select> on
 * macOS draws its menu over the field and can't be repositioned with CSS.
 * Follows the WAI-ARIA "select-only combobox" pattern so keyboard and
 * screen-reader users get what a native select would give them:
 * Enter/Space/↓ open, ↑/↓/Home/End move, Enter/Space choose, Esc/Tab close.
 */
export function Select({ label, value, options, onChange }: SelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options[selectedIndex];

  // Close when clicking anywhere outside the component.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  function openList() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option !== undefined && option.value !== value) onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(last);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1 text-sm">
      <span id={`${id}-label`} className="font-medium">
        {label}
      </span>
      <button
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        onClick={() => {
          if (open) setOpen(false);
          else openList();
        }}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-gray-300 bg-white py-2 pr-3 pl-3 text-left focus:border-blue-600 focus:ring-2 focus:ring-blue-200 focus:outline-none"
      >
        <span className="flex flex-1 items-center justify-between gap-3">
          <span>{selected?.label ?? 'Choose…'}</span>
          {selected?.detail !== undefined && (
            <span className="text-gray-500">{selected.detail}</span>
          )}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="M5 7.5 10 12.5 15 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-60 overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              onPointerEnter={() => {
                setActiveIndex(index);
              }}
              onClick={() => {
                choose(index);
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 ${
                index === activeIndex ? 'bg-blue-50' : ''
              } ${option.value === value ? 'font-medium text-blue-800' : ''}`}
            >
              <span>{option.label}</span>
              {option.detail !== undefined && (
                <span className="text-gray-500">{option.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
