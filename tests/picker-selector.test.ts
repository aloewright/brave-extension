import { beforeEach, describe, expect, it } from "vitest"

import { buildUniqueSelector } from "../src/lib/selector"

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>"
})

describe("buildUniqueSelector", () => {
  it("uses #id when the id is unique", () => {
    document.body.innerHTML = `
      <div id="hero">
        <p>hi</p>
      </div>
    `
    const el = document.getElementById("hero")!
    const sel = buildUniqueSelector(el)
    expect(sel).toBe("#hero")
    expect(document.querySelectorAll(sel).length).toBe(1)
  })

  it("falls back to a path when the id is duplicated", () => {
    // Two elements share the same id (invalid HTML but happens in the wild).
    document.body.innerHTML = `
      <div id="dup">A</div>
      <div id="dup">B</div>
    `
    const second = document.querySelectorAll("#dup")[1]
    const sel = buildUniqueSelector(second)
    expect(sel.startsWith("#dup")).toBe(false)
    const matched = document.querySelectorAll(sel)
    expect(matched.length).toBe(1)
    expect(matched[0]).toBe(second)
  })

  it("uses tag.class:nth-of-type for class+sibling disambiguation", () => {
    document.body.innerHTML = `
      <ul class="list">
        <li class="item">one</li>
        <li class="item">two</li>
        <li class="item">three</li>
      </ul>
    `
    const items = document.querySelectorAll("li.item")
    const sel = buildUniqueSelector(items[1])
    expect(sel).toContain("li.item")
    expect(sel).toContain(":nth-of-type(2)")
    const matched = document.querySelectorAll(sel)
    expect(matched.length).toBe(1)
    expect(matched[0]).toBe(items[1])
  })

  it("walks deep when needed and verifies uniqueness", () => {
    document.body.innerHTML = `
      <section>
        <div><span>x</span></div>
        <div><span>target</span></div>
      </section>
    `
    const target = document.querySelectorAll("span")[1]
    const sel = buildUniqueSelector(target)
    const matched = document.querySelectorAll(sel)
    expect(matched.length).toBe(1)
    expect(matched[0]).toBe(target)
  })

  it("ignores numeric-prefixed ids that look auto-generated", () => {
    document.body.innerHTML = `
      <div id="123abc"><span>hi</span></div>
    `
    const el = document.getElementById("123abc")!
    const sel = buildUniqueSelector(el)
    expect(sel.startsWith("#")).toBe(false)
    expect(document.querySelectorAll(sel).length).toBe(1)
  })

  it("produces a selector that matches exactly the target across complex trees", () => {
    document.body.innerHTML = `
      <main>
        <article class="post">
          <h1 class="title">A</h1>
          <p class="body">first</p>
        </article>
        <article class="post">
          <h1 class="title">B</h1>
          <p class="body">second</p>
        </article>
      </main>
    `
    const targets = document.querySelectorAll("p.body")
    for (const t of Array.from(targets)) {
      const sel = buildUniqueSelector(t)
      const matched = document.querySelectorAll(sel)
      expect(matched.length).toBe(1)
      expect(matched[0]).toBe(t)
    }
  })
})
