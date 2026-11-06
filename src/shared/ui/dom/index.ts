export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Required nodes belong to extension-owned templates; a missing node is a markup bug. */
export function requireElement<T extends Element>(element: T | null): T {
  if (!element) throw new Error("Required extension UI element is missing");
  return element;
}

/** Event targets can also be documents or text nodes. */
export function eventElement(target: EventTarget | null): Element | null {
  return isElement(target) ? target : null;
}
export function isElement(target: EventTarget | null): target is Element {
  return target !== null && "nodeType" in target && target.nodeType === 1;
}

/** cloneNode preserves an element's kind, but its DOM return type is Node. */
export function cloneElement(source: Element): Element {
  const clone = source.cloneNode(true);
  if (!isElement(clone)) throw new Error("Expected an element clone");
  return clone;
}
