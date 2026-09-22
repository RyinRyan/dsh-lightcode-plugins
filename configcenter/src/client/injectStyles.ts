/** Idempotent, lifecycle-bound style injection shared by both panels. */
export function injectStylesOnce(id: string, css: string): () => void {
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.pluginCss = id
  style.textContent = css
  document.head.appendChild(style)
  return () => {
    style.remove()
  }
}
