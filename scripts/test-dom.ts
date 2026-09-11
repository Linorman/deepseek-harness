/**
 * jsdom's missing dialog lifecycle API for component tests. Real-browser
 * scenarios own top-layer rendering, inertness, and focus-containment evidence.
 */

if (typeof HTMLDialogElement !== 'undefined' && !Object.hasOwn(HTMLDialogElement.prototype, 'showModal')) {
  HTMLDialogElement.prototype.showModal = function(): void { this.open = true }
  HTMLDialogElement.prototype.close = function(): void { this.open = false }
}
