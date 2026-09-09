/**
 * Browser-level smoke test: spec page → upload → processing view → canvas output.
 * Drives the locally installed Edge (channel:"msedge") — no browser download.
 * Start the dev server first, then:
 *   E2E_BASE=http://localhost:5199 node e2e/smoke.mjs
 */
import { chromium } from "playwright"

const BASE = process.env.E2E_BASE ?? "http://localhost:5173"

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true })
  const page = await browser.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e)))

  const failures = []
  const check = (name, cond) => {
    console.log(`${cond ? "✓" : "✗"} ${name}`)
    if (!cond) failures.push(name)
  }

  try {
    await page.goto(BASE, { waitUntil: "networkidle" })

    // 1. spec cards render from the /specs library
    const cards = await page.locator(".card").count()
    check(`spec cards render (${cards})`, cards >= 10)

    // 2. pick the CET spec (144×192, ≤30KB)
    await page.locator(".card", { hasText: "CET-4/6" }).first().click()
    check("drop zone appears after selecting a spec", await page.locator(".drop").count() >= 1)

    // 3. upload a synthetic photo via DataTransfer (procedural portrait-ish blob)
    await page.evaluate(() => {
      const c = document.createElement("canvas")
      c.width = 600
      c.height = 800
      const g = c.getContext("2d")
      g.fillStyle = "#b9c6d2"
      g.fillRect(0, 0, 600, 800)
      g.fillStyle = "#e8b990"
      g.beginPath()
      g.ellipse(300, 330, 105, 125, 0, 0, 7)
      g.fill()
      g.fillStyle = "#2c3646"
      g.beginPath()
      g.moveTo(120, 800)
      g.bezierCurveTo(130, 600, 180, 540, 300, 540)
      g.bezierCurveTo(420, 540, 470, 600, 480, 800)
      g.closePath()
      g.fill()
      const b64 = c.toDataURL("image/png").split(",")[1]
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const input = document.querySelector('input[type="file"]')
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], "photo.png", { type: "image/png" }))
      input.files = dt.files
      input.dispatchEvent(new Event("change", { bubbles: true }))
    })

    // 4. processing completes: checklist + canvas painted (allow CDN model time)
    await page.waitForSelector(".checks", { timeout: 90_000 })
    check("checklist appears", true)

    const canvasInfo = await page.evaluate(() => {
      const cv = document.querySelector("canvas")
      if (!cv || cv.width === 0) return null
      const ctx = cv.getContext("2d")
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data
      let sum = 0
      for (let i = 0; i < data.length; i += 400) sum += data[i] + data[i + 1] + data[i + 2]
      return { w: cv.width, h: cv.height, sum }
    })
    check(
      `canvas painted ${canvasInfo ? `${canvasInfo.w}×${canvasInfo.h}` : "missing"}`,
      canvasInfo !== null && canvasInfo.w === 144 && canvasInfo.h === 192 && canvasInfo.sum > 0,
    )

    // 5. size check reflects the spec cap (CET ≤30KB)
    const checklistText = await page.locator(".checks").innerText()
    check("file-size row present", /File size|Measuring/.test(checklistText))

    // 6. fine-tune slider reacts without killing the view
    await page.locator('.slider input[type="range"]').first().fill("1.2")
    await page.waitForTimeout(800)
    check("view alive after slider input", (await page.locator(".checks").count()) === 1)
  } catch (e) {
    failures.push(`flow error: ${e instanceof Error ? e.message : String(e)}`)
  }

  const blockingErrors = pageErrors.filter((e) => !e.includes("face detection unavailable"))
  check("no unexpected page errors", blockingErrors.length === 0)
  if (blockingErrors.length) console.log("  page errors:", blockingErrors.slice(0, 3))

  await browser.close()

  if (failures.length) {
    console.error(`\nSMOKE FAILED: ${failures.join("; ")}`)
    process.exit(1)
  }
  console.log("\nSMOKE PASSED")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
