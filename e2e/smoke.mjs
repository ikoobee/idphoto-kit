/**
 * Browser-level smoke test for the v2 four-step flow:
 *   #/specs → #/capture (upload path) → #/edit → #/export
 * Drives the locally installed Edge (channel:"msedge") — no browser download.
 * Start the dev server first, then:
 *   E2E_BASE=http://localhost:5199 node e2e/smoke.mjs
 *
 * The matting model is expected to be unavailable in CI (Release asset not
 * published yet) — the run asserts the DEGRADED path: crop still works, the
 * matte-down notice shows, export still fits the size budget.
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
  const waitForHash = (hash, timeout = 90_000) =>
    page.waitForURL((u) => u.hash === hash, { timeout })

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded" })

    // 1. spec cards render from the /specs library
    const cards = await page.locator(".card").count()
    check(`spec cards render (${cards})`, cards >= 10)

    // 2. pick the CET spec → capture page
    await page.locator(".card", { hasText: "四六级" }).first().click()
    await waitForHash("#/capture")
    check("capture page with drop zone", (await page.locator(".drop").count()) === 1)

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

    // 4. processing lands on the edit page with a painted canvas (CDN model time allowed)
    await waitForHash("#/edit")
    await page.waitForFunction(
      () => {
        const cv = document.querySelector("canvas.preview")
        return cv instanceof HTMLCanvasElement && cv.width === 144 && cv.height === 192
      },
      null,
      { timeout: 90_000, polling: 250 },
    )
    const canvasInfo = await page.evaluate(() => {
      const cv = document.querySelector("canvas.preview")
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

    // 5. degraded matting surfaces as a notice (or, with a local model, does not)
    const matteDown = await page.locator(".matteDown").count()
    const bgTab = await page.locator(".tab", { hasText: /背景|Background/ }).count()
    check("background tab present", bgTab === 1)
    console.log(
      `  matting degraded: ${matteDown > 0 ? "yes (expected until models-v0)" : "no (model present)"}`,
    )

    // 6. checks tab lists the spec cap (CET ≤30KB)
    await page.locator(".tab", { hasText: /检查|Checks/ }).click()
    await page.waitForSelector(".checks li")
    const checklistText = await page.locator(".checks").innerText()
    check("file-size row present", /文件体积|File size/.test(checklistText))

    // 7. adjust slider reacts without killing the view
    await page.locator(".tab", { hasText: /调整|Adjust/ }).click()
    await page.locator('.tabbody input[type="range"]').first().fill("10")
    await page.waitForTimeout(600)
    check("view alive after slider input", (await page.locator(".preview").count()) === 1)

    // 8. export page renders the download trio and fits the KB budget
    await page.locator("button", { hasText: /导出 →|Export →/ }).click()
    await waitForHash("#/export")
    await page.waitForSelector('button:has-text("下载电子照")', { timeout: 60_000 })
    const kbText = await page.locator(".kbctl").innerText()
    check("export fits target", /达标|within target/.test(kbText))
  } catch (e) {
    failures.push(`flow error: ${e instanceof Error ? e.message : String(e)}`)
  }

  const blockingErrors = pageErrors.filter(
    (e) => !e.includes("face detection unavailable") && !e.includes("matting unavailable"),
  )
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
