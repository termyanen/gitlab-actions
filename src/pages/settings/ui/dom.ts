import { requireElement } from "../../../shared/ui/dom";
export function byId(id: string): HTMLElement {
  return requireElement(document.getElementById(id));
}
function isInput(element: HTMLElement): element is HTMLInputElement {
  return element.tagName === "INPUT";
}
function isTextControl(
  element: HTMLElement,
): element is HTMLInputElement | HTMLTextAreaElement {
  return isInput(element) || element.tagName === "TEXTAREA";
}
function isValueControl(
  element: HTMLElement,
): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return isTextControl(element) || element.tagName === "SELECT";
}
function isButton(element: HTMLElement): element is HTMLButtonElement {
  return element.tagName === "BUTTON";
}
export function inputById(id: string) {
  const element = byId(id);
  if (!isInput(element)) throw new Error("Expected input: " + id);
  return element;
}
export function valueControlById(id: string) {
  const element = byId(id);
  if (!isValueControl(element)) throw new Error("Expected form control: " + id);
  return element;
}
export function textControlById(id: string) {
  const element = byId(id);
  if (!isTextControl(element)) throw new Error("Expected text control: " + id);
  return element;
}
export function buttonById(id: string) {
  const element = byId(id);
  if (!isButton(element)) throw new Error("Expected button: " + id);
  return element;
}
export function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
