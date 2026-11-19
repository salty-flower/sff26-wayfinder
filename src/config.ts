/**
 * Knobs of the wayfinder. Its only inputs are the organiser's floor plan and walkway graph,
 * fetched from the event's public ExpoFP map at build time.
 */
export const config = {
  /** Shown as the page title and heading. */
  name: "SFF 2026 Wayfinder",
  /** The organiser's own interactive map: the authority this helper defers to, linked from the about sheet. */
  official: "https://sgfintechfestival2026.expofp.com/",
  floorplan: {
    /** Level 1 of the floor plan: an SVG drawing wrapped in a script. */
    url: "https://sgfintechfestival2026.expofp.com/data/fp.svg.Level1.js",
    /** The walkway graph the organiser's map routes on. */
    walkwaysUrl: "https://sgfintechfestival2026.expofp.com/data/wf.data.js",
    /** The cached copies in data/floorplan/ are re-checked with the server when older than this. */
    recheckHours: 6,
    /** Names the plan writes in capitals and the venue spells with inner capitals. */
    spellings: ["FutureMatters"],
    /** A place with no door in the walkway data is tied to a walkway point at most this far from its edge. */
    snapMetres: 8,
  },
} as const;
