// Source for logo.png, the cover watermark of the generic export style.
//
// Regenerate after editing:
//
//   typst compile export-styles/generic/logo.typ export-styles/generic/logo.png --ppi 600
//
// `fill: none` gives a transparent background and `width/height: auto` sizes
// the page to the wordmark, so the PNG has no margin to crop.
//
// `bottom-edge: "descender"` is load-bearing. Typst measures a line to the
// baseline by default, so on an auto-height page anything below it falls off
// the bottom of the image. The old wordmark had no descender and never showed
// it; the "g" in Coursewright came out sliced in half.

#set page(width: auto, height: auto, margin: 2pt, fill: none)
#set text(font: ("Helvetica", "Arial"), bottom-edge: "descender")

#let muted = rgb("#8c959f")
#let ink = rgb("#59636e")

#block[
  #text(size: 7pt, weight: "bold", fill: muted, tracking: 0.32em)[BUILT WITH]
  #v(4pt, weak: true)
  #text(size: 19pt, weight: "regular", fill: ink, tracking: -0.01em)[Coursewright]
]
