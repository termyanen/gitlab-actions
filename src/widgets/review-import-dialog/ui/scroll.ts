/** Keep the visible comment in place even if a preceding result adds an error. */
export function rememberPreviewScroll(
  list: HTMLElement,
  outer: HTMLElement | null,
) {
  const positions = [list, ...(outer ? [outer] : [])].map((node) => ({
    node,
    top: node.scrollTop,
  }));
  const scroller = list.scrollHeight > list.clientHeight ? list : outer;
  const bounds = scroller?.getBoundingClientRect?.();
  const cards = () =>
    Array.from(list.querySelectorAll<HTMLElement>(".gl-review-import-item"));
  const itemId = (card: HTMLElement) =>
    card.querySelector<HTMLInputElement>("[data-import-item]")?.dataset
      .importItem;
  const anchor =
    bounds &&
    cards().find((card) => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
  const id = anchor && itemId(anchor);
  const offset =
    anchor && bounds ? anchor.getBoundingClientRect().top - bounds.top : 0;
  return () => {
    for (const { node, top } of positions) node.scrollTop = top;
    const current = id && cards().find((card) => itemId(card) === id);
    if (current && scroller)
      scroller.scrollTop +=
        current.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        offset;
  };
}
