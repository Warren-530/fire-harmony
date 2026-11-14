// Fire Harmony team poster, A1 portrait, in the report's look (Inter, ember accent, the report's figures).
// Build (run in poster/; --root .. lets the poster read ../report/figures):
//         ~/nasa_work/tools/quarto-1.11.9/bin/tools/x86_64/typst compile --root .. --font-path ../report/fonts poster.typ poster.pdf
//         (PNG for the project page, under 10 MB: add --format png --ppi 110 and the output name poster.png)
// Links and QR codes: edit LINKS below and run ../.venv/bin/python make_qr.py first.
// Figures: img/p_*.pdf, the report's data drawn again at poster size with 18 pt labels (../.venv/bin/python make_figures.py,
// run from the repository root as poster/make_figures.py). Screenshots: ../report/figures/app01_*.jpg and img/app_phone.jpg.

#let ember = rgb("#c8331a")
#let ember-soft = rgb("#fcf1ec")
#let ink = rgb("#0b0b0b")
#let ink2 = rgb("#52514e")
#let muted = rgb("#898781")
#let hair = rgb("#e3e2db")
#let surface = rgb("#fcfcfb")
#let card-fill = white
#let fig(name, ..args) = image("img/" + name + ".pdf", ..args)
#let note(t) = text(size: 18pt, fill: ink2)[#t]

#let LINKS = (
  (label: "Web app", url: "https://warren-530.github.io/fire-harmony/", qr: "qr/app.svg"),
  (label: "Report", url: "https://warren-530.github.io/fire-harmony/Fire_Harmony_report.pdf", qr: "qr/report.svg"),
  (label: "Videos, code, data", url: "https://warren-530.github.io/fire-harmony/hub.html", qr: "qr/hub.svg"),
)
#let TEAM = "Team Kopi and Cosmos"
#let MEMBERS = "Saw Yong Quan and Yap Yong Son"

#set page(width: 594mm, height: 841mm, margin: (x: 24mm, top: 20mm, bottom: 16mm), fill: surface)
#set text(font: "Inter", size: 20pt, fill: ink, lang: "en", region: "GB", hyphenate: false)
#set par(justify: false, leading: 0.6em, spacing: 0.85em)

#let eyebrow(t, fill: ember, size: 15pt) = text(size: size, weight: 600, fill: fill, tracking: 0.12em)[#upper(t)]
#let card(title, n: none, body) = block(width: 100%, height: 100%, fill: card-fill, radius: 6mm, inset: (x: 9mm, y: 8mm),
  stroke: 0.8pt + hair, breakable: false)[
  #grid(columns: (auto, 1fr), column-gutter: 5mm, align: horizon,
    if n != none { box(width: 12mm, height: 12mm, radius: 50%, fill: ember)[#align(center + horizon, text(size: 18pt, weight: 700, fill: white)[#n])] },
    text(size: 31pt, weight: 700, tracking: -0.01em)[#title])
  #v(1mm)
  #body
]
#let big(value, label, size: 46pt) = block(breakable: false)[
  #text(size: size, weight: 700, fill: ember, tracking: -0.02em)[#value] \
  #v(-4mm)
  #text(size: 18pt, fill: ink2)[#label]
]
#let shot(path, ..args) = box(radius: 3mm, clip: true, stroke: 0.8pt + hair)[#image(path, ..args)]

// ---------------------------------------------------------------- header: who we are, and the finding in one line
#block(width: 100%, fill: ink, radius: 6mm, inset: (x: 13mm, top: 8mm, bottom: 9mm))[
  #grid(columns: (auto, 1fr), column-gutter: 5mm, align: horizon,
    polygon.regular(fill: ember, size: 12mm, vertices: 6),
    eyebrow("NASA Space Apps Challenge 2026 · Kuala Lumpur · Harmonization of MODIS and VIIRS Hot Spots", fill: rgb("#c9cdd3")))
  #v(3mm)
  #grid(columns: (auto, 1fr), column-gutter: 14mm, align: (left + bottom, left + bottom),
    text(size: 96pt, weight: 700, fill: white, tracking: -0.035em)[Fire Harmony],
    [
      #text(size: 24pt, fill: rgb("#e6e8eb"))[One consistent worldwide fire record from MODIS and VIIRS, November 2000 to October 2026, for any place on Earth.]
      #v(2mm)
      #text(size: 18pt, fill: rgb("#c9cdd3"))[#text(weight: 600, fill: white)[#TEAM] #h(3mm) · #h(3mm) #MEMBERS]
      #v(3mm)
    ])
  #v(3mm)
  #line(length: 100%, stroke: 0.8pt + rgb("#3a3a38"))
  #v(4mm)
  #eyebrow("The problem, and our answer", fill: rgb("#ff9a5c"))
  #v(1mm)
  #text(size: 35pt, weight: 700, fill: white, tracking: -0.01em)[Joined without care, the two satellite records make a fake jump of 8.4 times in 2012. \ In Fire Harmony the step is 0.55%.]
]
#v(5mm)

// ---------------------------------------------------------------- how it works, in four steps
// Count: cells.parquet holds 413,699 level 5 hexagons, 254.9 km2 on average (meta.json files.cells, cells.area_km2).
#let step(n, name, body) = grid(columns: (auto, 1fr), column-gutter: 4mm, align: (left + horizon, left + horizon),
  box(width: 11mm, height: 11mm, radius: 50%, stroke: 1.6pt + ember)[#align(center + horizon, text(size: 17pt, weight: 700, fill: ember)[#n])],
  [#text(size: 20pt, weight: 700)[#name] \ #text(size: 16pt, fill: ink2)[#body]])
#let arrow = text(size: 26pt, fill: muted)[→]
#block(width: 100%, fill: card-fill, radius: 6mm, inset: (x: 9mm, y: 4mm), stroke: 0.8pt + hair, breakable: false)[
  #grid(columns: (auto, 1fr, auto, 1fr, auto, 1fr, auto, 1fr), column-gutter: 5mm, align: left + horizon,
    eyebrow("How it works", size: 14pt),
    step(1, "Count", [hotspots in 413,699 hexagons of about 255 km², each month]),
    arrow,
    step(2, "VIIRS", [three satellites averaged on the NOAA-20 scale]),
    arrow,
    step(3, "MODIS", [gradient boosting trained on 2012 to 2019 gives the count before 2012]),
    arrow,
    step(4, "Test", [held out years and regions, placebo seams, ESA burned area]),
  )
]
#v(5mm)

// ---------------------------------------------------------------- two rows of two cards
#set text(size: 20pt)
#grid(columns: (1fr, 1fr), column-gutter: 9mm, row-gutter: 7mm, rows: (219mm, 228mm),
  card(n: 1, "Why one factor cannot work")[
    At the same hour, Suomi NPP (VIIRS) counts *6.1 times* the hotspots of Aqua (MODIS) but only *1.3 times* the fire power: it sees weak fires that MODIS misses. In 9 hexagons out of 10 the rate lies between *4.1 and 13.5*, so a model learns what NOAA-20 would have counted.
    #v(1fr)
    #align(center, fig("p_exchange", height: 136mm))
    #v(2mm)
    #note[Level 3 hexagons, 2013 to 2019. Grey: too few Aqua hotspots to compare.]
  ],
  card(n: 2, "The proof")[
    #grid(columns: (1fr, 1fr, 1fr, 1fr), column-gutter: 5mm,
      big("0.55%", [step in 2012, when VIIRS starts. Ordinary years spread 1.2%]),
      big("0.85%", [step in 2002, when Aqua joins. Ordinary years spread 5.0%]),
      big("3.2%", [ESA agrees at the 2012 switch: the step against its burned area (720% if joined naively)]),
      big("92 to 96%", [of unseen monthly totals fall in their 90% range], size: 34pt),
    )
    #v(1fr)
    #fig("p_seam", width: 100%)
    #v(2mm)
    #note[World. The grey band is the 90% range of the modelled years.]
  ],
  card(n: 3, "What 25 years of trends show")[
    World hotspots fell by *6.3% per decade* from 2001 to 2025 (11.0% in a record from MODIS alone). Where there is enough fire to test, *1,950 hexagons fell and 810 rose* at a 5% false discovery rate: *2.4 falls for every rise* (95% range 1.7 to 2.5). MODIS alone gives the same sign for 48 of the 49 countries with a significant trend.
    #v(1fr)
    #align(center, fig("p_trend", height: 132mm))
    #v(2mm)
    #note[Coloured where the trend holds at a 5% false discovery rate.]
  ],
  card(n: 4, "Any place, any month")[
    Every month since 2001 as one box. Central Kalimantan, on Borneo, burns hardest in El Niño years, as in 2026.
    #v(1fr)
    #grid(columns: (1.36fr, 1fr), column-gutter: 6mm, align: (left + bottom, left + horizon),
      fig("p_calendar", width: 100%),
      stack(dir: ttb, spacing: 5mm,
        big("13.8×", [its normal fire in October 2026, the third highest October in 26 years]),
        big("84%", [chance of above normal fire in Indonesia in November 2026. Normal: 46%]),
        big("0.15", [Brier skill score one month ahead against a fixed 50% chance, on years the outlook never saw]),
        big("55%", [of Kuala Lumpur's haze beyond the usual season is explained by fires upwind, mostly in Sumatra]),
      ))
  ],
)
#v(5mm)

// ---------------------------------------------------------------- the app and the links
#block(width: 100%, height: 122mm, fill: ember-soft, radius: 6mm, inset: (x: 12mm, y: 8mm), stroke: 0.8pt + rgb("#f1c9bb"))[
  #grid(columns: (auto, auto, 1fr), rows: (100%,), column-gutter: 9mm, align: (left + top, left + top, left + top),
    stack(dir: ttb, spacing: 3mm, shot("../report/figures/app01_explorer_trend.jpg", height: 93mm),
      box(width: 149mm, note[The trend view: India, red where fire rose and blue where it fell.])),
    stack(dir: ttb, spacing: 3mm, shot("img/app_phone.jpg", height: 93mm),
      box(width: 66mm, note[On a phone: Central Kalimantan.])),
    [
      #text(size: 31pt, weight: 700)[The web app]
      #v(1mm)
      #set text(size: 20pt)
      - Any country, state or city, a drawn area, and any range of months.
      - Burning calendar, anomaly and rank, tested trends, drivers and the outlook.
      - Rankings of 4,330 places; every hotspot as CSV. Free, laptop or phone.
      - Ask in plain words: answers from the data, each linked to the map.
      #v(1fr)
      #grid(columns: (auto, auto, auto), column-gutter: 9mm,
        ..LINKS.map(l => stack(dir: ttb, spacing: 3mm,
          box(fill: white, inset: 2.5mm, radius: 2mm)[#image(l.qr, width: 40mm)],
          text(size: 18pt, weight: 600)[#l.label])))
    ],
  )
]

// ---------------------------------------------------------------- footer
#v(1fr)
#text(size: 12pt, fill: ink2)[
  *Data*: NASA FIRMS (MODIS Collection 6.1; VIIRS 375 m on Suomi NPP, NOAA-20 and NOAA-21), NASA LP DAAC (MCD12C1, MOD14A1, MYD14A1, VNP14A1, VJ114A1), NASA GES DISC (GPM IMERG, MERRA-2, MERRA-2 CNN PM2.5), NASA GISS (GFWED), NASA SEDAC (GPWv4), ESA Fire_cci, PEATMAP, GIHS, Natural Earth, NOAA (ONI, DMI). We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS). Code under the Apache 2.0 licence.
]
