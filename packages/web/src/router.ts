import { useEffect, useState } from "preact/hooks"

export const ROUTES = ["specs", "capture", "edit", "export"] as const
export type Route = (typeof ROUTES)[number]

/** Current hash route, kept in sync with location.hash ("#/edit" → "edit"). */
export function useHashRoute(): [Route, (r: Route) => void] {
  const parse = (): Route => {
    const h = location.hash.replace(/^#\//, "")
    return (ROUTES as readonly string[]).includes(h) ? (h as Route) : "specs"
  }
  const [route, setRoute] = useState<Route>(parse)
  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  return [route, (r) => (location.hash = `#/${r}`)]
}
