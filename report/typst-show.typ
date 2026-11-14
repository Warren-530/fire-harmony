// Passes the front matter to article() in typst-template.typ, including our own fields: team, members, challenge,
// event, links (label, url, qr), keypoints and a key figure for the abstract page (keyfigure, keyfigure-caption).
#show: doc => article(
$if(title)$
  title: [$title$],
$endif$
$if(subtitle)$
  subtitle: [$subtitle$],
$endif$
$if(date)$
  date: [$date$],
$endif$
$if(abstract)$
  abstract: [$abstract$],
$endif$
$if(team)$
  team: [$team$],
$endif$
$if(members)$
  members: ($for(members)$[$members$],$endfor$),
$endif$
$if(challenge)$
  challenge: [$challenge$],
$endif$
$if(event)$
  event: [$event$],
$endif$
$if(links)$
  links: ($for(links)$(label: "$links.label$", url: "$links.url$", qr: "$links.qr$"),$endfor$),
$endif$
$if(keypoints)$
  keypoints: ($for(keypoints)$[$keypoints$],$endfor$),
$endif$
$if(keyfigure)$
  keyfigure: "$keyfigure$",
$endif$
$if(keyfigure-caption)$
  keyfigure_caption: [$keyfigure-caption$],
$endif$
$if(section-numbering)$
  sectionnumbering: "$section-numbering$",
$endif$
$if(toc)$
  toc: $toc$,
$endif$
$if(toc-title)$
  toc_title: [$toc-title$],
$endif$
  toc_depth: $toc-depth$,
  doc,
)
