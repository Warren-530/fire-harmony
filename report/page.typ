// Page setup: A4, the project name in a quiet running header and the page number in the footer from page 2 on
// (the title page has neither).
#set page(
  paper: "a4",
  margin: (x: 2.3cm, top: 2.5cm, bottom: 2.3cm),
  numbering: "1",
  header: context {
    if counter(page).get().first() > 1 {
      set text(size: 7.5pt, fill: rgb("#898781"), tracking: 0.04em)
      grid(columns: (1fr, auto), [FIRE HARMONY], [NASA SPACE APPS CHALLENGE 2026])
      v(-5pt)
      line(length: 100%, stroke: 0.4pt + rgb("#e3e2db"))
    }
  },
  footer: context {
    if counter(page).get().first() > 1 {
      set text(size: 8pt, fill: rgb("#898781"))
      grid(columns: (1fr, auto), [One fire record from MODIS and VIIRS], counter(page).display("1"))
    }
  },
)
