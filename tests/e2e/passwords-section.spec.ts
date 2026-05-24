import { test, expect } from "./_fixtures"

test("passwords tab renders a responsive vault surface", async ({ openSidepanel }) => {
  const page = await openSidepanel()
  await page.setViewportSize({ width: 420, height: 760 })
  await page.locator("nav button[aria-label='Passwords']").click()

  await expect(page.getByTestId("passwords-section")).toBeVisible()
  await expect(page.getByRole("button", { name: "Vault", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Generator" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Web Vault" })).toBeVisible()
  await expect(page.getByRole("button", { name: "New" })).toBeVisible()

  const fitsNarrow = await page.getByTestId("passwords-section").evaluate((el) => {
    return el.scrollWidth <= el.clientWidth + 1
  })
  expect(fitsNarrow).toBe(true)

  await page.setViewportSize({ width: 900, height: 760 })
  const fitsWide = await page.getByTestId("passwords-section").evaluate((el) => {
    return el.scrollWidth <= el.clientWidth + 1
  })
  expect(fitsWide).toBe(true)
})
