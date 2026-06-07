import { describe, it, expect, beforeEach } from "vitest"
import { el, injectStyle } from "../../src/lib/github/dom"

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = "" })

describe("dom factory", () => {
  it("creates elements with props, dataset, and text children", () => {
    const node = el("button", { className: "x", title: "t", dataset: { id: "7" } }, "Hi")
    expect(node.tagName).toBe("BUTTON")
    expect(node.className).toBe("x")
    expect(node.title).toBe("t")
    expect(node.dataset.id).toBe("7")
    expect(node.textContent).toBe("Hi")
  })
  it("appends element children and sets onclick", () => {
    let clicked = false
    const child = el("span", {}, "c")
    const node = el("div", { onclick: () => { clicked = true } }, child)
    expect(node.querySelector("span")?.textContent).toBe("c")
    node.click()
    expect(clicked).toBe(true)
  })
  it("never uses innerHTML — text is escaped", () => {
    const node = el("div", {}, "<img src=x onerror=alert(1)>")
    expect(node.querySelector("img")).toBeNull()
    expect(node.textContent).toContain("<img")
  })
  it("injectStyle adds a single keyed <style>", () => {
    injectStyle("k1", ".a{color:red}")
    injectStyle("k1", ".a{color:red}")
    expect(document.querySelectorAll('style[data-rgh="k1"]').length).toBe(1)
  })
})
