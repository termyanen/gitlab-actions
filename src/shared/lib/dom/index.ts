export function q<T extends Element = HTMLElement>(
  parent: ParentNode | null | undefined,
  selectorStr: string,
): T | null {
  if (!parent) return null;
  try {
    return parent.querySelector<T>(selectorStr);
  } catch {
    return null;
  }
}
export function qAll<T extends Element = HTMLElement>(
  parent: ParentNode | null | undefined,
  selectorStr: string,
): NodeListOf<T> | T[] {
  if (!parent) return [];
  try {
    return parent.querySelectorAll<T>(selectorStr);
  } catch {
    return [];
  }
}
export function qUp<T extends Element = HTMLElement>(
  el: Element | null | undefined,
  selectorStr: string,
): T | null {
  if (!el) return null;
  try {
    return el.closest<T>(selectorStr);
  } catch {
    return null;
  }
}
export function insertAfterSafe(
  container: Node | null,
  newNode: Node | null,
  refNode?: Node | null,
) {
  if (!container || !newNode) return;
  if (!refNode) {
    container.appendChild(newNode);
    return;
  }
  // If refNode is a direct child of container, use insertBefore on nextSibling
  if (refNode.parentNode === container) {
    if (refNode.nextSibling) {
      container.insertBefore(newNode, refNode.nextSibling);
    } else {
      container.appendChild(newNode);
    }
  } else {
    // refNode is nested deeper — append to container end
    container.appendChild(newNode);
  }
}
