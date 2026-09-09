import { describe, expect, it } from "vitest"
import { composeBackground, parseHexColor } from "../src/compose.ts"
import { makeImage } from "../src/types.ts"

const RED_IMG = makeImage(2, 1, [255, 0, 0, 255, 255, 0, 0, 255])

describe("parseHexColor", () => {
  it("parses #RRGGBB", () => {
    expect(parseHexColor("#438EDB")).toEqual([0x43, 0x8e, 0xdb])
    expect(parseHexColor("#ffffff")).toEqual([255, 255, 255])
  })
  it("rejects malformed colors", () => {
    expect(() => parseHexColor("438EDB")).toThrow()
    expect(() => parseHexColor("#43GE DB")).toThrow()
    expect(() => parseHexColor("#fff")).toThrow()
  })
})

describe("composeBackground", () => {
  it("blends a semi-transparent portrait over solid background", () => {
    // alpha 128/255 over white: R = 255·a+255·(1−a) = 255, G/B = 255·(1−a) ≈ 127
    const alpha = Uint8ClampedArray.from([128, 255])
    const out = composeBackground(RED_IMG, alpha, { kind: "solid", color: "#FFFFFF" })
    expect([...out.data.slice(0, 4)]).toEqual([255, 127, 127, 255])
    // fully opaque pixel keeps pure foreground
    expect([...out.data.slice(4, 8)]).toEqual([255, 0, 0, 255])
  })

  it("transparent regions show the pure background color", () => {
    const alpha = Uint8ClampedArray.from([0, 0])
    const out = composeBackground(RED_IMG, alpha, { kind: "solid", color: "#438EDB" })
    expect([...out.data.slice(0, 4)]).toEqual([0x43, 0x8e, 0xdb, 255])
  })

  it("transparent option keeps straight alpha and portrait colors", () => {
    const alpha = Uint8ClampedArray.from([77, 200])
    const out = composeBackground(RED_IMG, alpha, { kind: "transparent" })
    expect([...out.data.slice(0, 8)]).toEqual([255, 0, 0, 77, 255, 0, 0, 200])
  })

  it("vertical gradient runs from top to bottom", () => {
    const img = makeImage(
      1,
      3,
      new Array(12).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0)),
    ) // transparent black portrait
    const alpha = Uint8ClampedArray.from([0, 0, 0])
    const out = composeBackground(img, alpha, { kind: "gradient", from: "#000000", to: "#FFFFFF" })
    const top = out.data[2]! // blue channel of row 0
    const mid = out.data[6]!
    const bot = out.data[10]!
    expect(top).toBe(0)
    expect(bot).toBe(255)
    expect(mid).toBeGreaterThan(100)
    expect(mid).toBeLessThan(155)
  })

  it("gradient interpolates under a partial-alpha portrait", () => {
    // alpha 128/255 red portrait over black→white gradient, bottom row
    const img = makeImage(1, 2, [255, 0, 0, 255, 255, 0, 0, 255])
    const alpha = Uint8ClampedArray.from([0, 128])
    const out = composeBackground(img, alpha, { kind: "gradient", from: "#000000", to: "#FFFFFF" })
    // bottom row bg is white → R = 255, G/B = 255·(1−128/255) = 127
    expect(out.data[4]).toBe(255)
    expect(out.data[5]).toBe(127)
    expect(out.data[6]).toBe(127)
  })

  it("throws when the matte size mismatches", () => {
    expect(() =>
      composeBackground(RED_IMG, Uint8ClampedArray.from([1, 2, 3]), { kind: "transparent" }),
    ).toThrow(/dimensions/)
  })
})
