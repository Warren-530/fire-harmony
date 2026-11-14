// Fire Harmony report template for Quarto + Typst: a title page with QR codes, an abstract page with the key results
// and the contents, then the text in Inter with ember accents. Colours from _brand.yml.

#let ember = rgb("#c8331a")
#let ember-soft = rgb("#fcf1ec")
#let ink = rgb("#0b0b0b")
#let ink2 = rgb("#52514e")
#let muted = rgb("#898781")
#let hair = rgb("#e3e2db")

// Quarto callouts (::: {.callout-note title="..."}) become a soft ember box: our "key finding" style.
#let callout(body: [], title: "Callout", background_color: none, icon: none, icon_color: none, body_background_color: none) = {
  block(breakable: false, width: 100%, fill: ember-soft, stroke: (left: 2.5pt + ember), radius: (right: 3pt),
    inset: (x: 12pt, y: 10pt), above: 1.2em, below: 1.2em)[
    #text(size: 7.5pt, weight: 600, fill: ember, tracking: 0.08em)[#upper(title)]
    #v(-3pt)
    #set par(justify: false)
    #body
  ]
}

#let label-text(t) = text(size: 7.5pt, weight: 600, fill: muted, tracking: 0.08em)[#upper(t)]

#let article(
  title: none,
  subtitle: none,
  date: none,
  abstract: none,
  team: none,
  members: (),
  challenge: none,
  event: none,
  links: (),
  keypoints: (),
  keyfigure: none,
  keyfigure_caption: none,
  sectionnumbering: none,
  toc: false,
  toc_title: none,
  toc_depth: none,
  doc,
) = {
  set document(title: title)
  set text(font: ("Inter",), size: 10pt, fill: ink, lang: "en", region: "GB", hyphenate: false)
  set par(justify: true, leading: 0.72em, spacing: 1.15em)
  // A paragraph never breaks across pages: a figure that floats to the top of the next page then always sits between
  // two paragraphs, never inside a sentence. Paragraphs are short, so the cost is a few lines of space at a page foot.
  show par: it => block(breakable: false, above: 1.15em, below: 1.15em, it)
  show raw: set text(font: ("JetBrains Mono",), size: 8.5pt)
  show link: set text(fill: ember)
  set list(indent: 0.4em, body-indent: 0.55em, spacing: 0.7em)
  set enum(indent: 0.4em, body-indent: 0.55em, spacing: 0.7em)
  // The text of a tight list item is not a paragraph, so the same rule is needed for each bullet. (Numbered items
  // cannot take it: a show rule on enum.item restarts their numbers.)
  show list.item: it => block(breakable: false, width: 100%, it)
  set heading(numbering: sectionnumbering)

  show heading.where(level: 1): it => {
    set text(size: 15pt, weight: 700, fill: ink, tracking: -0.01em)
    set par(justify: false)
    block(above: 2em, below: 1em, sticky: true)[
      #if it.numbering != none [#text(fill: ember)[#context counter(heading).display(it.numbering)]#h(9pt)]#it.body
    ]
  }
  show heading.where(level: 2): it => {
    set text(size: 11.5pt, weight: 600, fill: ink)
    set par(justify: false)
    block(above: 1.6em, below: 0.8em, sticky: true)[
      #if it.numbering != none [#text(fill: muted)[#context counter(heading).display(it.numbering)]#h(7pt)]#it.body
    ]
  }
  show heading.where(level: 3): it => {
    set text(size: 10pt, weight: 600, fill: ink)
    block(above: 1.3em, below: 0.7em, sticky: true)[#it.body]
  }

  // figures: caption under the picture ("Figure 3. The finding. What is shown. Source."), tables: title above
  show figure.caption: it => {
    set text(size: 8.5pt, fill: ink2)
    set par(justify: false, leading: 0.62em)
    set align(left)                                   // a caption of several lines reads best from the left edge
    // a table title stays on the page of its table
    block(width: 100%, above: 0.7em, sticky: it.position == top)[#text(weight: 600, fill: ink)[#it.supplement #context it.counter.display(it.numbering).] #it.body]
  }
  // pictures float to the top of a page (or of the next one), so a figure that does not fit leaves no half empty page,
  // and with unbreakable paragraphs (above) it never splits a sentence
  show figure.where(kind: "quarto-float-fig"): set figure(placement: top)
  set place(clearance: 1.4em)
  show figure.where(kind: "quarto-float-tbl"): set figure.caption(position: top)
  show figure.where(kind: "quarto-float-tbl"): set block(breakable: true)   // long tables continue on the next page
  show figure: set block(above: 1.5em, below: 1.5em)
  set table(
    inset: (x: 6pt, y: 4.6pt),
    stroke: (x, y) => if y == 0 { (bottom: 0.7pt + ink) } else { (bottom: 0.3pt + hair) },
  )
  show table: set text(size: 8.8pt)
  show table: set par(justify: false)
  show table.cell.where(y: 0): set text(weight: 600)

  // ---------------------------------------------------------------- title page
  page(header: none, footer: none, margin: (x: 2.3cm, top: 2.4cm, bottom: 2.1cm))[
    #set par(justify: false)
    #grid(columns: (auto, 1fr), column-gutter: 10pt, align: horizon,
      polygon.regular(fill: ember, size: 22pt, vertices: 6),
      text(size: 8pt, fill: ink2, tracking: 0.1em, weight: 600)[#if event != none [#upper(event)]])
    #v(3cm)
    #text(size: 42pt, weight: 700, fill: ink, tracking: -0.025em)[#title]
    #v(0.35cm)
    #block(width: 88%)[#text(size: 15pt, fill: ink2)[#subtitle]]
    #v(0.8cm)
    #line(length: 2.8cm, stroke: 3pt + ember)
    #v(0.8cm)
    #grid(columns: (2.6cm, 1fr), row-gutter: 11pt, column-gutter: 10pt, align: (left + top, left + top),
      ..(
        if challenge != none { (label-text("Challenge"), challenge) } else { () }
      ) + (
        if team != none { (label-text("Team"), team) } else { () }
      ) + (
        if members.len() > 0 { (label-text("Members"), members.join(", ")) } else { () }
      ) + (
        if date != none { (label-text("Date"), date) } else { () }
      )
    )
    #v(1fr)
    #if links.len() > 0 {
      line(length: 100%, stroke: 0.4pt + hair)
      v(10pt)
      grid(columns: (1fr, 1.32fr, 1.18fr), column-gutter: 12pt,
        ..links.map(l => block[
          #image(l.qr, width: 2.5cm)
          #v(5pt)
          #let u = l.url.replace("\\/", "/")   // Pandoc escapes "/" for Typst markup
          #let shown = u.replace("https://", "").trim("/", at: end)
          #text(size: 9pt, weight: 600)[#l.label] \
          #box(text(size: 7.2pt, fill: ink2)[#link(u)[#shown]])
        ]))
    }
  ]

  // ---------------------------------------------------------------- abstract, key results and contents
  if abstract != none {
    block(width: 100%, below: 1.4em)[
      #text(size: 7.5pt, weight: 600, fill: ember, tracking: 0.1em)[ABSTRACT]
      #v(-1pt)
      #abstract
    ]
  }
  if keyfigure != none {
    block(width: 100%, above: 0.6em, below: 1.0em, breakable: false)[
      #text(size: 7.5pt, weight: 600, fill: ember, tracking: 0.1em)[AT A GLANCE]
      #v(-2pt)
      #image(keyfigure.replace("\\_", "_").replace("\\/", "/"), width: 100%)   // Pandoc escapes "_" and "/"
      #if keyfigure_caption != none {
        set text(size: 8.5pt, fill: ink2)
        set par(justify: false, leading: 0.62em)
        keyfigure_caption
      }
    ]
  }
  if keypoints.len() > 0 {
    callout(title: "Three more things to know", body: list(..keypoints))
  }
  if toc {
    pagebreak()
    show outline.entry.where(level: 1): set text(weight: 600)
    outline(title: text(size: 11.5pt, weight: 600)[#toc_title], depth: toc_depth, indent: 1.4em)
  }
  pagebreak()
  doc
}
