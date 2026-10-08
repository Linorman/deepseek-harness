/** DOM lookups by data attribute without building selectors from arbitrary ids. */

/**
 * Find the first element under `root` whose `data-<attribute>` equals `value`.
 * @param root - Search root; null yields undefined.
 * @param attribute - Attribute name without the `data-` prefix, in kebab case.
 * @param value - Exact attribute value.
 * @returns the matching element, if any.
 */
export function elementByData(root: ParentNode | null | undefined, attribute: string, value: string): HTMLElement | undefined {
  if (root === null || root === undefined) return undefined
  for (const element of root.querySelectorAll<HTMLElement>(`[data-${attribute}]`)) {
    if (element.getAttribute(`data-${attribute}`) === value) return element
  }
  return undefined
}
