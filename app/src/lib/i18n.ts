// Interface text for Fire Harmony (English).
// Rules for every string: short plain sentences, no jargon, no hyphenated words except official names
// (NOAA-20, MERRA-2). In Malay this also means no reduplicated words with a hyphen.

import { createContext, useContext } from 'react';
import type { AreaSelection, ColourMode, MapMode, NamedArea, Scale, Source } from './types.ts';

export type Lang = 'en';
export const LANGS: readonly Lang[] = ['en'];

type Kind = NamedArea['kind'];

/** Data sources listed on the Data page (names and links live in Data.tsx). */
export type SourceId =
  | 'firms' | 'lpdaac' | 'gesdisc' | 'gfwed' | 'sedac' | 'firecci' | 'peatmap' | 'gihs' | 'naturalearth' | 'noaa' | 'basemap';

/** Published data files (paths live in Downloads.tsx). */
export type FileKey =
  | 'meta' | 'areas' | 'area_monthly' | 'cells' | 'map_l3' | 'map_l4' | 'cell_l3' | 'cell_l4' | 'clim_l3' | 'clim_l4'
  | 'l5' | 'drivers' | 'drivers_models' | 'outlook' | 'haze' | 'haze_json' | 'dashboard';

interface SourceText { what: string; use: string; licence: string }
interface ColumnText { name: string; text: string }

export interface Dict {
  locale: string;
  appName: string;
  appTitle: string;
  tagline: string;
  skip: string;
  nav: { label: string; explorer: string; dashboard: string; haze: string; methods: string; data: string; language: string; english: string; malay: string };
  common: {
    loading: string;
    retry: string;
    reload: string;
    errorTitle: string;
    errorHint: string;
    details: string;
    pageError: string;
    panelError: string;
    world: string;
    kinds: Record<Kind, string>;
    months: readonly string[];
    monthsShort: readonly string[];
    sources: Record<Source, string>;
    hemi: { n: string; s: string; e: string; w: string };
    areaNear: (where: string) => string;
    circle: (km: string, where: string) => string;
    km2: (n: string) => string;
  };
  explorer: {
    controls: string;
    scale: string;
    scales: Record<Scale, string>;
    scaleHelp: Record<Scale, string>;
    colour: string;
    modes: Record<ColourMode, string>;
    units: Record<Scale, string>;
    mapTitle: (month: string) => string;
    mapLabel: string;
    previousMonth: string;
    nextMonth: string;
    mapLoading: string;
    mapError: string;
    levelNote: Record<3 | 4, string>;
    hexHint: string;
    drawHint: string;
    summary: string;
    calendarTitle: string;
    calendarHelp: Record<ColourMode, string>;
    chartTitle: string;
    downloadsTitle: string;
    loadingSeries: (name: string) => string;
    firstVisit: string;
    updating: string;
    seriesError: string;
    metaError: string;
    mapShows: (month: string) => string;
    showing: (name: string) => string;
    eyebrow: string;
    lead: { world: (to: string) => string; named: (kind: string, size: string, to: string) => string; drawn: (what: string, size: string, to: string) => string };
    drawnKinds: { polygon: string; hexagon: string; circle: (km: string) => string };
    dataTo: (month: string) => string;
    copyLink: string;
    linkCopied: string;
    copyFailed: string;
    linkUnknown: string;
    tooLarge: string;
    years: string;
    yearsFrom: string;
    yearsTo: string;
    numbersNote: string;
    mapSub: { count: (what: string, size: string) => string; anomaly: (month: string) => string; what: Record<Scale, string> };
    mapAnomalyNote: string;
    legend: Record<Scale | 'anomaly', string>;
    noFire: string;
    noDataYet: string;
    normalLabel: string;
    tip: {
      hotspots: (n: string) => string; normal: (month: string, n: string) => string; times: (r: string) => string;
      noNormal: string; modis: (n: string) => string; raw: (n: string) => string; click: string;
    };
    hexLabel: (where: string) => string;
    draw: { finish: string; undo: string; cancel: string; firstCorner: string };
    numbersTitle: string;
  };
  ex: {
    regionLabel: string;
    panelLabel: string;
    collapse: string;
    expand: string;
    copyLink: string;
    linkCopied: string;
    linkFailed: string;
    linkUnknown: string;
    wholeWorld: string;
    kindLine: (kind: string, size: string) => string;
    drawnArea: string;
    hexagon: string;
    circleKind: string;
    about: (size: string) => string;
    radiusOf: (km: string) => string;
    hexNear: (where: string) => string;
    loading: string;
    starting: string;
    updating: (name: string) => string;
    tabsLabel: string;
    tabs: { overview: string; calendar: string; period: string; why: string; outlook: string; download: string };
    monthTile: (month: string) => string;
    monthOnMap: (month: string) => string;
    yearTile: string;
    worldSentence: string;
    shortcuts: string;
    readMore: string;
    readLess: string;
    latestBadge: string;
    previewBadge: string;
    calendarHelp: string;
    /** The title of a burning calendar, as its finding: the runs of critical months (first, last) and the peak month. */
    calendarFinding: (runs: readonly (readonly [string, string])[], peak: string | null) => string;
    sourceLine: string;
    namedOnly: string;
    tooLarge: string;
    map: {
      label: string;
      controls: string;
      colour: string;
      scale: string;
      to3d: string;
      to2d: string;
      view3d: string;
      zoomIn: string;
      zoomOut: string;
      zoomGroup: string;
      reset: string;
      scaleShort: Record<Scale, string>;
      loading: string;
      detail: string;
      error: string;
      anomalyNote: string;
      heightNote: string;
      hexSize: Record<3 | 4, string>;
    };
    tip: {
      hotspots: Record<Scale, string>;
      normal: (month: string) => string;
      against: string;
      noNormal: string;
      none: string;
      click: string;
      locating: string;
    };
    timeline: {
      label: string;
      play: string;
      pause: string;
      back: string;
      forward: string;
      speed: string;
      speedOption: (x: number) => string;
      speedCycle: (now: string) => string;
      scrubber: (name: string) => string;
      valueText: (month: string, value: string) => string;
      noData: string;
      hint: string;
      shown: (month: string) => string;
      loop: string;
    };
    tools: { label: string; rectangle: string; polygon: string; circle: string; world: string };
    toasts: { csv: string; png: string; failed: string };
    download: {
      lead: (name: string, from: string, to: string) => string;
      csvTitle: string;
      pngTitle: string;
      filesTitle: string;
      calendarNeeds: string;
    };
    calendarHelpTouch: string;
    /** The card of a first visit (package A): what a hexagon and normal mean, three steps and three stories. */
    welcome: {
      title: string; lead: string; stepsLabel: string; steps: [string, string, string]; start: string;
      stories: { kalimantan: string; corrientes: string; kualaLumpur: string }; close: string;
    };
  };
  /** The Explorer's area panel: the number strip, the details, the trend rules, the header tools, the download menu,
   *  compare, the phone sheet and the link notes (package explorer-panel). */
  exPanel: {
    strip: {
      label: string;
      unit: string;
      ytd: (month: string, yr: number) => string;
      ytdShort: (month: string) => string;
      wholeYear: (yr: number) => string;
      trend: string;
      trendShort: string;
      noneNormal: string;
      asUsual: string;
      noMonth: string;
      monthTip: (month: string, value: string, vs: string | null) => string;
      ytdTip: (span: string, value: string, vs: string | null) => string;
      trendTip: (pct: string, word: string, notes: string) => string;
      open: { calendar: string; period: string; overview: string };
    };
    details: { label: string; normalOf: (n: string) => string; mean: (n: string) => string };
    trend: {
      rising: string;
      falling: string;
      flat: string;
      flatShort: string;
      none: string;
      little: string;
      littleShort: string;
      littleWhy: (here: string) => string;
      untested: string;
      untestedWhy: (floor: string) => string;
      pending: string;
      ownClear: (p: string) => string;
      caution: (mean: string) => string;
      holds: (n: string, kind: string) => string;
      fails: (n: string, kind: string) => string;
      barren: string;
      kinds: Record<'world' | 'continent' | 'country' | 'state' | 'hexagon' | 'area', string>;
      about: (n: string) => string;
      almostNone: string;
      justUnder: (floor: string) => string;
      chartUntested: (name: string) => string;
      chartBarren: (name: string) => string;
      chartUp: (name: string, pct: string) => string;
      chartDown: (name: string, pct: string) => string;
      chartUpUnsure: (name: string, pct: string, kind: string) => string;
      chartDownUnsure: (name: string, pct: string, kind: string) => string;
    };
    tools: {
      download: string;
      downloadTip: string;
      compare: string;
      pin: (name: string) => string;
      unpin: (name: string) => string;
      compareFull: string;
      compareOnly: string;
      search: string;
      searchClose: string;
      share: string;
    };
    menu: {
      label: string;
      csv: string;
      csvHint: string;
      hotspots: string;
      hotspotsHint: string;
      chart: string;
      calendar: string;
      pngHint: string;
      files: string;
      filesHint: string;
      waiting: string;
      close: string;
    };
    compare: {
      label: string;
      remove: (name: string) => string;
      clear: string;
      counts: string;
      share: string;
      switchLabel: string;
      title: (n: number) => string;
      subtitle: { count: string; share: string };
      loading: string;
      failed: (name: string) => string;
      pinned: (name: string) => string;
      unpinned: (name: string) => string;
      full: string;
      shownHere: string;
      tip: (yr: number) => string;
      tipShare: (name: string, pct: string, n: string) => string;
      tipCount: (name: string, n: string) => string;
      year: string;
      hint: string;
    };
    sheet: {
      handle: (size: string) => string;
      sizes: { peek: string; half: string; full: string };
      play: string;
      pause: string;
    };
    link: {
      area: string; shape: string; crossing: string; month: (from: string, to: string) => string; monthBad: string; view: string; compare: string;
      compareMax: string;
    };
    loadingPlace: (name: string) => string;
    /** The compare chart as a picture, and the menu item of one place (package A). */
    exports: { chartCompare: string; chartCompareHint: string; chartOwn: string; title: (names: string[]) => string };
  };
  /** The Explorer's map: settings, legend, hexagon tooltip, drawing and the timeline's zoom (package explorer-map). */
  exMap: {
    controls: string;
    pill: (mode: string, scale: string, view: string) => string;
    close: string;
    closeLegend: string;
    colour: string;
    modes: Record<MapMode, string>;
    modeHelp: Record<MapMode, string>;
    modeKeys: Record<MapMode, string>;
    scale: string;
    scaleTrend: string;
    view3d: string;
    view3dHint: string;
    heightNote: { month: string; trend: string };
    legend: string;
    legendChip: (what: string) => string;
    legendShort: Record<Scale | 'anomaly' | 'trend', string>;
    trend: {
      legendTitle: string;
      rising: string;
      falling: string;
      flat: string;
      untested: (floor: string) => string;
      classesLabel: string;
      why: string;
      tested: (n: string, total: string, level: number) => string;
      note: string;
      band: string;
      playTip: string;
      showMonths: string;
      chip: string;
    };
    tip: {
      trend: string;
      perDecade: (v: string) => string;
      p: string;
      q: string;
      mean: string;
      clear: { rising: string; falling: string };
      flat: string;
      untested: string;
      untestedWhy: (floor: string) => string;
      years: string;
    };
    status: { loading: string; detail: string; trend: string };
    draw: {
      polygonTouch: string;
      rectangleTouch: string;
      firstCornerTouch: string;
      cancelTouch: string;
      crosses: string;
    };
    timeline: {
      hint: string;
      reset: string;
      range: (from: string, to: string) => string;
      zoomed: (from: string, to: string) => string;
    };
    /** Package A: the hotspots as dots at city zoom, the link to NASA FIRMS, the map's keys and the legend's range. */
    dots: {
      legend: string; loading: string; capped: (n: string) => string; date: string; time: string; satellite: string; frp: string;
      mw: (v: string) => string; firms: string; firmsTip: string; firmsNote: (month: string) => string;
    };
    keysHint: string;
    rangeShort: (lo: string, hi: string) => string;
  };
  calendar: {
    title: (name: string) => string;
    subtitle: Record<ColourMode, string>;
    scaleNote: Record<Scale, string>;
    rank: (rank: number, years: number, month: string) => string;
    normal: (month: string, n: string) => string;
    noNormal: (month: string) => string;
    noData: string;
    onMap: string;
    clickToShow: string;
    keyHelp: string;
    units: Record<Scale, (n: string) => string>;
    yearTotal: (yr: number, n: string) => string;
    modelledNone: string;
    modelledNoneLong: string;
    tapToShow: string;
    tapHelp: string;
    /** The burning calendar at full size (package A). */
    full: {
      expand: string; label: (name: string) => string; years: (from: number, to: number) => string; close: string; download: string;
      making: string; colour: string; count: string; anomaly: string; critical: string; help: string; helpTouch: string;
    };
  };
  kpi: {
    month: (month: string) => string;
    ytd: (month: string, yr: number) => string;
    wholeYear: (yr: number) => string;
    trend: (from: number, to: number) => string;
    trendFew: string;
    critical: string;
    hotspots: string;
    millionHotspots: string;
    perDecade: string;
    ytdNormal: (n: string) => string;
    noFireUsual: string;
    fireUnusual: string;
    trendTest: (p: string) => string;
    trendClear: string;
    trendWithin: string;
    tooFew: string;
    criticalContext: (peak: string) => string;
    criticalNone: string;
    runs: (runs: string[]) => string;
    runText: (from: string, to: string) => string;
  };
  chart: {
    title: { up: (name: string, pct: string) => string; down: (name: string, pct: string) => string; flat: (name: string) => string; few: (name: string) => string; raw: string };
    subtitle: Record<Scale, string>;
    source: string;
    partial: (yr: number, month: string) => string;
    modelled: string;
    observed: string;
    cols: { year: string; hotspots: string; low: string; high: string; source: string; harmonized: string };
    tipRange: (lo: string, hi: string) => string;
    soFar: (month: string) => string;
    /** The year so far on the yearly chart (package A). */
    partialKey: (yr: number, month: string) => string;
    partialLine: (yr: number, month: string, count: string, against: string) => string;
    partialNormal: string;
    partialTip: (yr: number, month: string) => string;
    soFarShort: string;
  };
  picker: {
    label: string;
    search: string;
    placeholder: string;
    suggestions: string;
    results: (n: number) => string;
    none: string;
    loadingPlaces: string;
    placesError: string;
    drawRectangle: string;
    drawPolygon: string;
    latLon: string;
    drawingRectangle: string;
    drawingPolygon: string;
    escape: string;
    cancel: string;
    latitude: string;
    longitude: string;
    radius: string;
    latLonHelp: string;
    latError: string;
    lonError: string;
    radiusError: string;
    show: string;
    close: string;
    world: string;
    worldTitle: string;
    drawTitle: string;
    circleTitle: string;
    clear: string;
  };
  downloads: {
    csv: string;
    csvHelp: string;
    pngCalendar: string;
    pngChart: string;
    pngHelp: string;
    saved: (file: string) => string;
    failed: string;
    waiting: string;
    filesTitle: string;
    filesHelp: string;
    fileCols: { file: string; size: string; about: string };
    files: Record<FileKey, string>;
    l5Files: (n: string) => string;
    imageSource: string;
    title: string;
    subtitle: (name: string, from: number, to: number) => string;
    help: string;
    sizeMb: (mb: string) => string;
    making: string;
    calendarSub: (name: string, from: number, to: number) => string;
  };
  methods: {
    // (the Methods page words live in pages/Methods.tsx and components/methods/*, next to the numbers they read)
    coverageScales: Record<string, string>;
  };
  data: {
    title: string;
    lead: string;
    sourcesTitle: string;
    cols: { source: string; what: string; use: string; licence: string };
    sources: Record<SourceId, SourceText>;
    citeTitle: string;
    citeIntro: string;
    citeOthers: string;
    filesTitle: string;
    filesIntro: string;
    columnsTitle: string;
    columns: readonly ColumnText[];
    zeroNote: string;
    monthsNote: (first: string, last: string) => string;
    codeTitle: string;
    code: string;
  };
  panels: {
    calendarLabel: (name: string) => string;
    noData: string;
    hotspots: string;
    normal: string;
    timesNormal: (ratio: string) => string;
    kpiMonth: string;
    kpiYear: (month: string) => string;
    kpiTrend: string;
    kpiCritical: string;
    above: string;
    below: string;
    nearNormal: string;
    rank: (rank: number, years: number, month: string) => string;
    percentile: (p: string) => string;
    increasing: string;
    decreasing: string;
    noTrend: string;
    notEnough: string;
    perDecade: (pct: string) => string;
    pValue: (p: string) => string;
    criticalNone: string;
    chartYearly: string;
    chartRange: string;
    modisScale: string;
    harmonizedLabel: string;
    sensors: { t: string; a: string; s: string; n: string; j: string };
    briefTitle: string;
    partialYear: string;
  };
  drivers: {
    title: (month: string) => string;
    loading: string;
    error: string;
    noModel: string;
    drawnArea: string;
    fire: string;
    rain: string;
    heat: string;
    enso: string;
    fireWeather: string;
    pctBelow: (pct: string) => string;
    pctAbove: (pct: string) => string;
    aboutNormal: string;
    warmer: (deg: string) => string;
    cooler: (deg: string) => string;
    ensoState: { strongNino: string; nino: string; nina: string; strongNina: string; neutral: string };
    notYet: string;
    fwiNote: string;
    heatNotDriver: string;
    rainPoints: (x: string) => string;
    rainPointsHigh: string;
    offSeason: string;
    bothPoint: (x: string) => string;
    bothPointHigh: string;
    actual: (x: string) => string;
    skill: (pct: string) => string;
    lowSkill: string;
    ensoDry: (lag: number) => string;
    ensoWet: (lag: number) => string;
    titleQuiet: (month: string) => string;
    titleNormal: (month: string) => string;
    subtitle: string;
    pointsTitle: string;
    noMonth: (month: string) => string;
    drawnTitle: string;
    /** Drivers without a value in the month shown (package A). */
    latestOf: (label: string, month: string) => string;
    notOut: (what: string[], month: string) => string;
    showLatest: (month: string) => string;
    shortNames: { heat: string; enso: string; fireWeather: string; rain: string; fire: string };
    pointsTo: { rain: (vs: string) => string; both: (vs: string) => string; actual: (vs: string) => string };
    fwiTo: (month: string) => string;
  };
  outlook: {
    title: string;
    issued: (month: string) => string;
    loading: string;
    error: string;
    none: string;
    chance: string;
    normalChance: (p: string) => string;
    skillLabel: { good: string; some: string; none: string };
    note: string;
    subtitle: (month: string) => string;
    chanceOf: string;
    normalChanceLine: (p: string) => string;
    drawnArea: string;
    /** Package A: always the next three months, in plain words. */
    headline: (p: string, month: string) => string;
    pastAbove: (p: string) => string;
    offSeason: (month: string, n: string) => string;
    offSeasonNone: (month: string) => string;
    subtitle3: (month: string) => string;
    forState: (state: string, city: string) => string;
    noState: string;
  };
  haze: {
    title: string;
    lead: string;
    city: string;
    loading: string;
    error: string;
    chartTitle: (city: string) => string;
    chartSub: string;
    observed: string;
    model: string;
    merra2: string;
    who: string;
    sourcesTitle: (city: string) => string;
    sourcesSub: string;
    sumatra: string;
    borneo: string;
    shareLine: (city: string, sumatra: string, borneo: string) => string;
    skillLine: (pct: string) => string;
    perThousand: (source: string, ug: string) => string;
    latest: (month: string, model: string, smoke: string) => string;
    daysLine: (days: string, month: string) => string;
    methodTitle: string;
    method: readonly string[];
    limitsTitle: string;
    limits: readonly string[];
  };
  footer: { line: string; dataVersion: (version: string, built: string) => string };
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

const en: Dict = {
  locale: 'en-GB',
  appName: 'Fire Harmony',
  appTitle: 'Fire Harmony: one fire record from MODIS and VIIRS',
  tagline: 'One consistent fire record from MODIS and VIIRS, 2000 to today',
  skip: 'Skip to content',
  nav: {
    label: 'Main', explorer: 'Explorer', dashboard: 'Dashboard', haze: 'Haze', methods: 'Methods', data: 'Data', language: 'Language',
    english: 'English', malay: 'Bahasa Melayu',
  },
  common: {
    loading: 'Loading…',
    retry: 'Try again',
    reload: 'Reload the page',
    errorTitle: 'Error',
    errorHint: 'Check your internet connection, then try again.',
    details: 'Technical details',
    pageError: 'This page could not be shown.',
    panelError: 'This part could not be shown.',
    world: 'World',
    kinds: { world: 'World', continent: 'Continent', country: 'Country', state: 'State' },
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
      'November', 'December'],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    sources: {
      0: 'VIIRS observed', 1: 'model from MODIS Terra + Aqua', 2: 'model from MODIS Terra only', 3: 'no data yet',
    },
    hemi: { n: 'N', s: 'S', e: 'E', w: 'W' },
    areaNear: (where) => `Area near ${where}`,
    circle: (km, where) => `${km} km around ${where}`,
    km2: (n) => `${n} km²`,
  },
  explorer: {
    controls: 'Area and scale',
    scale: 'Scale',
    scales: { harmonized: 'Harmonized', modis: 'MODIS scale', raw: 'Raw sensors' },
    scaleHelp: {
      harmonized: 'The whole record on one scale: what one NOAA-20 VIIRS satellite would record.',
      modis: 'The same record on the MODIS scale (one satellite), to compare with older studies. It dips by about 7% from July 2002 to June 2003, because Aqua saw relatively few fires in its first year.',
      raw: 'Each satellite as it recorded. The numbers in the cards stay on the harmonized scale.',
    },
    colour: 'Colour',
    modes: { count: 'Fire count', anomaly: 'Against normal' },
    units: {
      harmonized: 'Hotspots per month on the NOAA-20 VIIRS scale',
      modis: 'Hotspots per month on the MODIS scale (one satellite)',
      raw: 'Raw detections of each satellite, with the harmonized record',
    },
    mapTitle: (month) => `Fire in ${month}`,
    mapLabel: 'Fire map',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    mapLoading: 'Loading the map…',
    mapError: 'Could not load the map for this month.',
    levelNote: {
      3: 'Each hexagon covers about 12,400 km². Zoom in for more detail.',
      4: 'Each hexagon covers about 1,800 km².',
    },
    hexHint: 'Click a hexagon to see its history.',
    drawHint: 'Drawing on the map.',
    summary: 'At a glance',
    calendarTitle: 'Burning calendar',
    calendarHelp: {
      count: 'Each box is one month. Darker boxes had more fire. Click a box to show that month on the map.',
      anomaly: 'Each box is one month. Red means more fire than normal, blue means less. Click a box to show that month on the map.',
    },
    chartTitle: 'Fire over the years',
    downloadsTitle: 'Downloads',
    loadingSeries: (name) => `Loading the fire record for ${name}…`,
    firstVisit: 'The first visit can take a few seconds while the data engine starts.',
    updating: 'Updating…',
    seriesError: 'Could not load the fire record for this area.',
    metaError: 'Could not start the explorer.',
    mapShows: (month) => `The map now shows ${month}.`,
    showing: (name) => `Showing ${name}.`,
    eyebrow: 'Explorer',
    lead: {
      world: (to) => `Fire hotspots across the whole world, on one consistent scale from 2001 to ${to}.`,
      named: (kind, size, to) => `${kind}, ${size}. Fire hotspots on one consistent scale from 2001 to ${to}.`,
      drawn: (what, size, to) => `${what}, about ${size}. Fire hotspots on one consistent scale from 2001 to ${to}.`,
    },
    drawnKinds: { polygon: 'An area you drew', hexagon: 'One hexagon of the map', circle: (km) => `A circle of ${km} km radius` },
    dataTo: (m) => `Data to ${m}`,
    copyLink: 'Copy link',
    linkCopied: 'Link copied',
    copyFailed: 'Copy the link from the address bar.',
    linkUnknown: 'The link points to a place or a month we could not find, so we show what we can.',
    tooLarge: 'This area is too large. Draw a smaller one.',
    years: 'Years',
    yearsFrom: 'From',
    yearsTo: 'to',
    numbersNote: 'The numbers and the brief always use the harmonized record.',
    mapSub: {
      count: (what, size) => `${what} in each hexagon of about ${size}`,
      anomaly: (m) => `Each hexagon against its normal for ${m}, on the harmonized record`,
      what: { harmonized: 'Harmonized hotspots', modis: 'Hotspots on the MODIS scale', raw: 'Raw detections of all satellites' },
    },
    mapAnomalyNote: 'Against normal uses the harmonized record on every scale. It is the only one with a normal for each hexagon.',
    legend: {
      harmonized: 'Hotspots per month, NOAA-20 VIIRS scale',
      modis: 'Hotspots per month, MODIS scale',
      raw: 'Raw detections per month, all satellites',
      anomaly: 'Times the normal for that month',
    },
    noFire: 'No fire',
    noDataYet: 'No data yet',
    normalLabel: 'normal',
    tip: {
      hotspots: (n) => `${n} hotspots`,
      normal: (m, n) => `Normal for ${m}: ${n}`,
      times: (r) => `${r} times normal`,
      noNormal: 'No fire is normal here',
      modis: (n) => `MODIS scale: ${n}`,
      raw: (n) => `Raw detections: ${n}`,
      click: 'Click to see its history',
    },
    hexLabel: (where) => `Hexagon at ${where}`,
    draw: { finish: 'Finish', undo: 'Undo point', cancel: 'Cancel', firstCorner: 'Now click the opposite corner.' },
    numbersTitle: 'At a glance',
  },
  ex: {
    regionLabel: 'Fire explorer',
    panelLabel: 'Area, numbers and details',
    collapse: 'Hide the panel',
    expand: 'Show the panel',
    copyLink: 'Copy a link to this view',
    linkCopied: 'Link copied',
    linkFailed: 'Could not copy. Copy the link from the address bar.',
    linkUnknown: 'The link points to a place we could not find, so we show the world.',
    wholeWorld: 'The whole world',
    kindLine: (kind, size) => (size ? `${kind} · ${size}` : kind),
    drawnArea: 'Drawn area',
    hexagon: 'Hexagon',
    circleKind: 'Circle',
    about: (size) => `about ${size}`,
    radiusOf: (km) => `${km} km radius`,
    hexNear: (where) => `Hexagon near ${where}`,
    loading: 'Loading…',
    starting: 'Starting the data engine. The first visit takes a few seconds.',
    updating: (name) => `Loading ${name}…`,
    tabsLabel: 'Details',
    tabs: { overview: 'Overview', calendar: 'Calendar', period: 'Period', why: 'Why', outlook: 'Outlook', download: 'Download' },
    monthTile: (m) => m,
    monthOnMap: (m) => m,
    yearTile: 'Year to date',
    worldSentence: 'the world',
    shortcuts: 'Keyboard shortcuts (?)',
    readMore: 'Read more',
    readLess: 'Show less',
    latestBadge: 'Latest',
    previewBadge: 'Preview',
    calendarHelp: 'Each box is one month, years down and months across. Hover a box to preview it on the map, click to show it.',
    calendarFinding: (runs, peak) => {
      if (runs.length === 0) return peak ? `Fire usually peaks in ${peak}` : 'In most years there is little or no fire here';
      const season = runs.map(([a, b]) => (a === b ? a : `${a} to ${b}`)).join(' and ');
      const oneMonth = runs.length === 1 && runs[0][0] === runs[0][1];
      return oneMonth || !peak ? `The fire season is ${season}` : `The fire season is ${season}, peaking in ${peak}`;
    },
    sourceLine: 'Hotspots from NASA FIRMS (MODIS C6.1 and VIIRS 375 m), on one scale by Fire Harmony.',
    namedOnly: 'Shown for named places. Pick a country or a state to see it.',
    tooLarge: 'This area is too large. Draw a smaller one.',
    map: {
      label: 'Fire map. Drag to move, scroll to zoom, click a hexagon to select it.',
      controls: 'Map settings',
      colour: 'Colour',
      scale: 'Scale',
      to3d: 'Show the hexagons in 3D (D)',
      to2d: 'Show the hexagons flat (D)',
      view3d: '3D',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      zoomGroup: 'Zoom',
      reset: 'Show the whole area',
      scaleShort: { harmonized: 'Harmonized', modis: 'MODIS', raw: 'Raw' },
      loading: 'Loading the map…',
      detail: 'Loading the detailed hexagons…',
      error: 'Could not load the map for this month.',
      anomalyNote: 'Against normal always uses the harmonized record.',
      heightNote: 'Height shows the fire count.',
      hexSize: {
        3: 'Each hexagon covers about 12,400 km². Zoom in for more detail.',
        4: 'Each hexagon covers about 1,800 km².',
      },
    },
    tip: {
      hotspots: { harmonized: 'Hotspots', modis: 'Hotspots, MODIS scale', raw: 'Raw detections' },
      normal: (m) => `Normal for ${m}`,
      against: 'Against normal',
      noNormal: 'Fire where none is normal',
      none: 'No fire',
      click: 'Click to select this hexagon',
      locating: 'Finding the place…',
    },
    timeline: {
      label: 'Timeline',
      play: 'Play the months (Space)',
      pause: 'Pause (Space)',
      back: 'Previous month (Left arrow)',
      forward: 'Next month (Right arrow)',
      speed: 'Speed',
      speedOption: (x) => `${x}x`,
      speedCycle: (now) => `Speed ${now}. Press to change.`,
      scrubber: (name) => `Month on the map. The line shows fire each month in ${name}.`,
      valueText: (m, v) => `${m}, ${v}`,
      noData: 'no data yet',
      hint: 'Hover to preview a month. Click or drag to pick it.',
      shown: (m) => `Showing ${m}`,
      loop: 'The player loops from November 2000 to the latest full month.',
    },
    tools: { label: 'Pick or draw an area', rectangle: 'Rectangle', polygon: 'Polygon', circle: 'Circle', world: 'World' },
    toasts: { csv: 'CSV saved', png: 'Picture saved', failed: 'Could not make the file. Please try again.' },
    download: {
      lead: (name, from, to) => `${name}, ${from} to ${to}.`,
      csvTitle: 'The monthly record',
      pngTitle: 'Pictures for a report',
      filesTitle: 'Data files',
      calendarNeeds: 'Open the calendar once to make its picture.',
    },
    calendarHelpTouch: 'Each box is one month, years down and months across. Tap a box to show that month on the map.',
    welcome: {
      title: 'One fire record for the whole world',
      lead: 'Each hexagon is a patch of land, coloured by its satellite hotspots in the month shown. Normal is the middle value of that month in 2001 to 2025.',
      stepsLabel: 'How it works',
      steps: ['Pick or draw a place', 'Read its burning calendar', 'Download the CSV'],
      start: 'Start here',
      stories: {
        kalimantan: 'Central Kalimantan, the 2015 haze',
        corrientes: 'Corrientes, Argentina, the Iberá fires of 2022',
        kualaLumpur: 'Kuala Lumpur and the haze',
      },
      close: 'Close the welcome',
    },
  },
  exPanel: {
    strip: {
      label: 'Key numbers',
      unit: 'Hotspots on the NOAA-20 VIIRS scale',
      ytd: (m, yr) => `Jan to ${m} ${yr}`,
      ytdShort: (m) => `Jan to ${m}`,
      wholeYear: (yr) => `All of ${yr}`,
      trend: 'Decade trend',
      trendShort: 'Trend',
      noneNormal: 'usually none',
      asUsual: 'as usual',
      noMonth: 'No month with data yet.',
      monthTip: (m, v, vs) => `${m}: ${v} hotspots${vs ? `, ${vs}` : ''}.`,
      ytdTip: (span, v, vs) => `${span}: ${v} hotspots${vs ? `, ${vs}` : ''}.`,
      trendTip: (pct, word, notes) => `Trend of yearly fire, 2001 to 2025: ${pct} per decade, ${word.toLowerCase()}.${notes ? ` ${notes}` : ''}`,
      open: { calendar: 'Open the calendar.', period: 'Open the period.', overview: 'Open the overview.' },
    },
    details: {
      label: 'The numbers in words',
      normalOf: (n) => `normal ${n}`,
      mean: (n) => `About ${n} hotspots a year on average, 2001 to 2025.`,
    },
    trend: {
      rising: 'Rising',
      falling: 'Falling',
      // the words of the one verdict, the same as the Dashboard and Rankings (components/dashboard/verdict.ts)
      flat: 'Not clear',
      flatShort: 'Not clear',
      none: 'Too few years',
      little: 'Too little fire',
      littleShort: 'Too little fire',
      // (`here`: "about 30", or "just under 100" for a mean the file rounds up to the floor)
      littleWhy: (here) => `Under 100 hotspots a year (here ${here}), the small values before 2012 make falls that are not real, so no trend is read.`,
      untested: 'Not tested',
      untestedWhy: (floor) => `Too little fire to test: under ${floor} hotspots a year.`,
      pending: 'Testing the trend',
      ownClear: (p) => `Clear on its own test of yearly totals (p ${p}).`,
      caution: (mean) => `Little fire (about ${mean} hotspots a year): read this trend with care.`,
      holds: (n, kind) => `Still clear when all ${n} ${kind} with enough fire are tested together`,
      fails: (n, kind) => `Not clear once all ${n} ${kind} with enough fire are tested together`,
      barren: 'Most fire here is on bare land, so this place is not tested with the others.',
      kinds: { world: 'places', continent: 'continents', country: 'countries', state: 'states', hexagon: 'hexagons of this size', area: 'areas' },
      about: (n) => `about ${n}`,
      almostNone: 'almost none',
      justUnder: (floor) => `just under ${floor}`,
      // the chart's title says no more than the card's word (explorer/trendWords.ts chartTitle)
      chartUntested: (name) => `Yearly fire in ${name}: too little to test a trend`,
      chartBarren: (name) => `Yearly fire in ${name}: not tested, as most of it is on bare land`,
      chartUp: (name, pct) => `Yearly fire in ${name} may be rising, by about ${pct} per decade, but there is little fire`,
      chartDown: (name, pct) => `Yearly fire in ${name} may be falling, by about ${pct} per decade, but there is little fire`,
      chartUpUnsure: (name, pct, kind) => `Yearly fire in ${name} may be rising, by about ${pct} per decade, but not clearly among all ${kind}`,
      chartDownUnsure: (name, pct, kind) => `Yearly fire in ${name} may be falling, by about ${pct} per decade, but not clearly among all ${kind}`,
    },
    tools: {
      download: 'Download',
      downloadTip: 'Download the data, the hotspots and pictures',
      compare: 'Compare',
      pin: (name) => `Pin ${name} to compare`,
      unpin: (name) => `Unpin ${name}`,
      compareFull: 'Three places are pinned. Unpin one to add another.',
      compareOnly: 'Only named places, hexagons and circles can be pinned.',
      search: 'Find or draw a place',
      searchClose: 'Close the search',
      share: 'Link',
    },
    menu: {
      label: 'Downloads',
      csv: 'Monthly record (CSV)',
      csvHint: 'Every month with its 90% range and each satellite',
      hotspots: 'Hotspots of a period (CSV)',
      hotspotsHint: 'Pick the months in the Period tab',
      chart: 'Chart (PNG)',
      calendar: 'Calendar (PNG)',
      pngHint: 'Ready for a report',
      files: 'All data files',
      filesHint: 'Parquet and JSON, for DuckDB, Python or R',
      waiting: 'Ready when the data has loaded',
      close: 'Close',
    },
    compare: {
      label: 'Compared with',
      remove: (name) => `Remove ${name}`,
      clear: 'Clear',
      counts: 'Hotspots',
      share: '% of its mean',
      switchLabel: 'Show',
      title: (n) => (n === 2 ? 'Yearly fire in two places' : `Yearly fire in ${n} places`),
      subtitle: {
        count: 'Hotspots per year on the NOAA-20 VIIRS scale. Sizes differ a lot: try % of its mean.',
        share: 'Each place against its own mean of 2001 to 2025 (100% is a usual year), so big and small places compare.',
      },
      loading: 'Loading the pinned places…',
      failed: (name) => `Could not load ${name}.`,
      pinned: (name) => `${name} pinned to compare`,
      unpinned: (name) => `${name} unpinned`,
      full: 'Three places are pinned already',
      shownHere: 'shown',
      tip: (yr) => String(yr),
      tipShare: (name, pct, n) => `${name}: ${pct} of its mean (${n})`,
      tipCount: (name, n) => `${name}: ${n}`,
      year: 'Year',
      hint: 'Pin up to three places with Compare, then pick another place: the chart shows them together.',
    },
    sheet: {
      handle: (size) => `Panel size: ${size}. Press to change, or use the up and down arrows.`,
      sizes: { peek: 'small', half: 'half', full: 'full' },
      play: 'Play the months',
      pause: 'Pause',
    },
    link: {
      area: 'The link points to a place we could not find, so we show the world.',
      shape: 'The link has a place or shape we could not read, so the view stays as it was.',
      crossing: 'The link has a shape whose edges cross, so we show the world.',
      month: (from, to) => `The link has a month outside the record (${from} to ${to}), so we show the nearest month.`,
      monthBad: 'The link has a month we could not read, so the month stays as it was.',
      view: 'Part of the link could not be read, so those settings stay as they were.',
      compare: 'Some pinned places in the link could not be read and were left out.',
      compareMax: 'The link pins more than three places, so only the first three are pinned.',
    },
    loadingPlace: (name) => `Loading ${name}…`,
    exports: {
      chartCompare: 'Chart (PNG)',
      chartCompareHint: 'The places you compare, as shown',
      chartOwn: 'This place only (PNG)',
      title: (names) => `Yearly fire in ${names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`,
    },
  },
  exMap: {
    controls: 'Map settings',
    pill: (mode, scale, view) => `Map settings: ${mode}, ${scale}, ${view}`,
    close: 'Close map settings',
    closeLegend: 'Close the legend',
    colour: 'Colour',
    modes: { count: 'Fire count', anomaly: 'Against normal', trend: 'Trend 2001 to 2025' },
    modeHelp: {
      count: 'Hotspots in the month on the map',
      anomaly: 'The month against its normal',
      trend: 'Change per decade from 2001 to 2025, one map for the whole record',
    },
    modeKeys: { count: 'C', anomaly: 'A', trend: 'R' },
    scale: 'Scale',
    scaleTrend: 'The trend is measured on the harmonized record.',
    view3d: '3D columns',
    view3dHint: 'Tilt the map and raise the hexagons',
    heightNote: { month: 'Height shows the fire count.', trend: 'Height shows the hotspots a year.' },
    legend: 'Legend',
    legendChip: (what) => `Legend: ${what}`,
    legendShort: { harmonized: 'Hotspots a month', modis: 'MODIS scale', raw: 'Raw detections', anomaly: 'Times normal', trend: 'Trend per decade' },
    trend: {
      legendTitle: 'Trend, % per decade, 2001 to 2025',
      rising: 'Rising',
      falling: 'Falling',
      flat: 'Not clear',      // the one verdict's word, as in the panel, the Dashboard and Rankings
      untested: (floor) => `Too little fire to test (under ${floor} hotspots a year)`,
      classesLabel: 'Trend classes, with the number of hexagons in each',
      why: 'Many hexagons are tested at once, so only trends that hold at a 5% false discovery rate are coloured.',
      tested: (n, total, level) => `${n} of ${total} level ${level} hexagons tested`,
      note: 'One map for 2001 to 2025. The month only changes the panel.',
      band: 'Trend years',
      playTip: 'Play the months. The map goes back to fire count.',
      showMonths: 'Show months',
      chip: 'One map for 2001 to 2025',
    },
    tip: {
      trend: 'Trend',
      perDecade: (v) => `${v} a decade`,
      p: 'p value',
      q: 'False discovery rate (q)',
      mean: 'Hotspots a year',
      clear: { rising: 'Rising, a clear trend', falling: 'Falling, a clear trend' },
      flat: 'Not clear',
      untested: 'Too little fire to test',
      untestedWhy: (floor) => `Under ${floor} hotspots a year, so it is not tested.`,
      years: '2001 to 2025',
    },
    status: { loading: 'Loading the map…', detail: 'Loading finer hexagons…', trend: 'Loading the trend map…' },
    draw: {
      polygonTouch: 'Tap points on the map, then tap Finish.',
      rectangleTouch: 'Tap one corner, then the opposite corner.',
      firstCornerTouch: 'Now tap the opposite corner.',
      cancelTouch: 'Tap Cancel to stop.',
      crosses: 'The shape crosses itself. Undo a point and try again.',
    },
    timeline: {
      hint: 'Scroll or pinch to zoom into the years, or drag across the strip under the years. Double click to see all years.',
      reset: 'Show all years',
      range: (from, to) => `${from} to ${to}`,
      zoomed: (from, to) => `Showing ${from} to ${to}`,
    },
    dots: {
      legend: 'Dots: each counted hotspot (raw, not harmonized)',
      loading: 'Loading the hotspots…',
      capped: (n) => `Showing ${n} of them, picked at random`,
      date: 'Date',
      time: 'Time (UTC)',
      satellite: 'Satellite',
      frp: 'Fire power (FRP)',
      mw: (v) => `${v} MW`,
      firms: 'Last days on NASA FIRMS',
      firmsTip: 'Open NASA FIRMS at this place, for the fires of the last days',
      firmsNote: (m) => `This record ends in ${m}. For the fires of the last days, open NASA FIRMS.`,
    },
    keysHint: 'Arrow keys move the map, + and − zoom.',
    rangeShort: (lo, hi) => `${lo} to ${hi}`,
  },
  calendar: {
    title: (name) => `When does ${name} burn?`,
    subtitle: {
      count: 'Each box is one month, years down and months across. Darker boxes had more fire. The colours follow this area’s own range, so the season and the bad years stand out.',
      anomaly: 'Each box is one month, years down and months across. Red had more fire than normal for that month, blue had less.',
    },
    scaleNote: {
      harmonized: 'On the harmonized record: what one NOAA-20 VIIRS satellite would record.',
      modis: 'On the MODIS scale. It dips by about 7% from July 2002 to June 2003, because Aqua saw relatively few fires in its first year.',
      raw: 'Raw detections of all satellites added up. They jump when a new satellite starts: VIIRS in 2012, NOAA-20 in 2018 and NOAA-21 in 2024. That is why the record needs harmonizing.',
    },
    rank: (r, n, m) => (r === 1 ? `Highest ${m} in ${n} years` : r === n ? `Lowest ${m} in ${n} years` : `${ordinal(r)} highest ${m} in ${n} years`),
    normal: (m, n) => `Normal for ${m}: ${n}`,
    noNormal: (m) => `No fire is normal in ${m}`,
    noData: 'No data yet for this month.',
    onMap: 'Shown on the map',
    clickToShow: 'Click to show it on the map',
    keyHelp: 'Click a box to show that month on the map. With the keyboard, use the arrow keys and press Enter.',
    units: {
      harmonized: (n) => (n === '1' ? '1 hotspot' : `${n} hotspots`),
      modis: (n) => `${n} hotspots on the MODIS scale`,
      raw: (n) => `${n} raw detections`,
    },
    yearTotal: (yr, n) => `${yr} in total: ${n}`,
    modelledNone: 'Modelled; MODIS saw none',
    modelledNoneLong: 'Modelled from MODIS, which saw no fire here this month.',
    tapToShow: 'Tap to show it on the map',
    tapHelp: 'Tap a box to show that month on the map.',
    full: {
      expand: 'Expand calendar',
      label: (name) => `Burning calendar of ${name}, full size`,
      years: (from, to) => `${from} to ${to}, years down and months across`,
      close: 'Close the calendar',
      download: 'Download PNG',
      making: 'Making the picture…',
      colour: 'Colour',
      count: 'Count',
      anomaly: 'Against normal',
      critical: 'Critical period',
      help: 'Hover a box, or move with the arrow keys, to read it. Click or press Enter to show that month on the map.',
      helpTouch: 'Tap a box to show that month on the map.',
    },
  },
  kpi: {
    month: (m) => `Latest month, ${m}`,
    ytd: (m, yr) => `January to ${m} ${yr}`,
    wholeYear: (yr) => `The whole of ${yr}`,
    trend: (from, to) => `Trend, ${from} to ${to}`,
    trendFew: 'Trend',
    critical: 'Critical period',
    hotspots: 'hotspots',
    millionHotspots: 'million hotspots',
    perDecade: 'per decade',
    ytdNormal: (n) => `Normal for these months: ${n}`,
    noFireUsual: 'No fire, as usual',
    fireUnusual: 'Fire where none is normal',
    trendTest: (p) => `(test on yearly totals, p ${p})`,
    trendClear: 'A clear trend',
    trendWithin: 'Within the normal ups and downs',
    tooFew: 'Too few full years with fire to tell.',
    criticalContext: (peak) => `Usual peak: ${peak}`,
    criticalNone: 'No month stands out',
    runs: (runs) => runs.join(' and '),
    runText: (from, to) => (from === to ? from : `${from} to ${to}`),
  },
  chart: {
    title: {
      up: (name, pct) => `Yearly fire in ${name} is rising, by about ${pct} per decade`,
      down: (name, pct) => `Yearly fire in ${name} is falling, by about ${pct} per decade`,
      flat: (name) => `Yearly fire in ${name} shows no clear rise or fall`,
      few: (name) => `Fire over the years in ${name}`,
      raw: 'Raw detections jump when new satellites start. The harmonized record does not.',
    },
    subtitle: {
      harmonized: 'Hotspots per year on the NOAA-20 VIIRS scale. The grey band is the 90% range of the years modelled from MODIS.',
      modis: 'Hotspots per year on the MODIS scale (one satellite).',
      raw: 'Detections per year by each satellite, as recorded, next to the harmonized record.',
    },
    source: 'Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m). Analysis: Fire Harmony.',
    partial: (yr, m) => `${yr}, January to ${m}`,
    modelled: 'Modelled from MODIS',
    observed: 'Observed by VIIRS',
    cols: { year: 'Year', hotspots: 'Hotspots', low: '90% range, low', high: '90% range, high', source: 'Source', harmonized: 'Harmonized' },
    tipRange: (lo, hi) => `90% range: ${lo} to ${hi}`,
    soFar: (m) => `so far, to ${m}`,
    partialKey: (yr, m) => `${yr} so far (to ${m})`,
    partialLine: (yr, m, n, vs) => `${yr} to ${m}: ${n} hotspots, ${vs}.`,
    partialNormal: 'normal for these months',
    partialTip: (yr, m) => `${yr}, January to ${m}`,
    soFarShort: 'so far',
  },
  picker: {
    label: 'Area',
    search: 'Find a place',
    placeholder: 'Find a country or state',
    suggestions: 'Suggestions',
    results: (n) => (n === 1 ? '1 place found.' : `${n} places found.`),
    none: 'No place matches. Try another spelling.',
    loadingPlaces: 'Loading places…',
    placesError: 'Place search is not available right now.',
    drawRectangle: 'Draw rectangle',
    drawPolygon: 'Draw polygon',
    latLon: 'Lat, lon and radius',
    drawingRectangle: 'Press and drag on the map to draw a rectangle, or click two corners.',
    drawingPolygon: 'Click points on the map. Double click, or press Finish, to close the shape.',
    escape: 'Press Escape to cancel.',
    cancel: 'Cancel',
    latitude: 'Latitude',
    longitude: 'Longitude',
    radius: 'Radius (km)',
    latLonHelp: 'Use decimal degrees. South and west are negative.',
    latError: 'Enter a latitude from −90 to 90.',
    lonError: 'Enter a longitude from −180 to 180.',
    radiusError: 'Enter a radius from 1 to 2,000 km.',
    show: 'Show this area',
    close: 'Close',
    world: 'World',
    worldTitle: 'Back to the whole world',
    drawTitle: 'Draw an area on the map',
    circleTitle: 'A circle from latitude, longitude and radius',
    clear: 'Clear the search',
  },
  downloads: {
    csv: 'Monthly record (CSV)',
    csvHelp: 'Every month, with the 90% range, the source and each satellite.',
    pngCalendar: 'Calendar (PNG)',
    pngChart: 'Chart (PNG)',
    pngHelp: 'Pictures of the calendar and the chart, ready for a report.',
    saved: (file) => `Saved ${file}.`,
    failed: 'Could not make the file. Please try again.',
    waiting: 'Downloads are ready when the data has loaded.',
    filesTitle: 'Data files',
    filesHelp: 'Open files in Parquet and JSON. You can read them with DuckDB, Python or R.',
    fileCols: { file: 'File', size: 'Size', about: 'What it holds' },
    files: {
      meta: 'Version, months covered, sources and the 90% range tables. Read this first.',
      areas: 'Every named place: continents, countries and states, with their size.',
      area_monthly: 'The monthly series of every named place.',
      cells: 'Facts for each small hexagon: country, state, land cover, peat and people.',
      map_l3: 'The map of each month, large hexagons (about 12,400 km²).',
      map_l4: 'The map of each month, medium hexagons (about 1,800 km²).',
      cell_l3: 'The same values as map_l3, sorted by hexagon, for drawn areas.',
      cell_l4: 'The same values as map_l4, sorted by hexagon, for drawn areas.',
      clim_l3: 'The normal of each large hexagon for each calendar month, 2001 to 2025.',
      clim_l4: 'The normal of each medium hexagon for each calendar month, 2001 to 2025.',
      l5: 'Full detail: small hexagons (about 250 km²), one file per large region.',
      drivers: 'The drivers of every month of every named place: rain, heat, El Niño and fire weather.',
      drivers_models: 'How well the drivers explain the fire of each named place.',
      outlook: 'The outlook: the chance of above normal fire in the next three months.',
      haze: 'Monthly PM2.5 and smoke from fires at each city of the haze link.',
      haze_json: 'The haze model of each city.',
      dashboard: 'Every headline number of the Dashboard page.',
    },
    l5Files: (n) => `${n} files`,
    imageSource: 'Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m). Analysis: Fire Harmony.',
    title: 'Downloads',
    subtitle: (name, from, to) => `${name}, ${from} to ${to}`,
    help: 'The CSV has every month with its 90% range, its normal and each satellite. The pictures are ready for a report.',
    sizeMb: (mb) => `${mb} MB`,
    making: 'Making the file…',
    calendarSub: (name, from, to) => `${name}, ${from} to ${to}. Each box is one month.`,
  },
  methods: {
    coverageScales: {
      'cell x month': 'One hexagon, one month',
      'region L4 x month': 'Small region, one month',
      'region L3 x month': 'Large region, one month',
      'continent x month': 'Continent, one month',
      'world x month': 'World, one month',
      'region L3 x year': 'Large region, one year',
      'continent x year': 'Continent, one year',
    },
  },
  data: {
    title: 'Data',
    lead: 'Fire Harmony uses only free and open data. Here are the sources, how to cite this work, and every file the app reads.',
    sourcesTitle: 'Sources and licences',
    cols: { source: 'Source', what: 'What we use', use: 'Why', licence: 'Licence' },
    sources: {
      firms: {
        what: 'Active fire hotspots: MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP, NOAA-20, NOAA-21)',
        use: 'The fires: every number in this app',
        licence: 'Free and open, no restrictions',
      },
      lpdaac: {
        what: 'MCD12C1 land cover; daily fire maps and burned area for checks',
        use: 'Land cover facts for the model, and checks',
        licence: 'Free and open, no restrictions',
      },
      gesdisc: {
        what: 'MERRA-2 weather and aerosols, and bias corrected PM2.5 (MERRA-2 CNN); GPM IMERG rainfall',
        use: 'Drivers of unusual months, the outlook and the haze link',
        licence: 'Free and open, no restrictions',
      },
      gfwed: {
        what: 'Global Fire Weather Database (GFWED): the fire weather index, from MERRA-2',
        use: 'Fire weather next to each month',
        licence: 'Free and open, no restrictions',
      },
      sedac: { what: 'GPWv4 population density, 2020', use: 'People who live near fire', licence: 'CC BY 4.0' },
      firecci: {
        what: 'Fire_cci burned area grids',
        use: 'An independent check of the harmonized record',
        licence: 'ESA CCI terms: free, please cite',
      },
      peatmap: { what: 'PEATMAP global peatland map (Xu and others, 2018)', use: 'Peat facts for the model', licence: 'CC BY 4.0' },
      gihs: {
        what: 'Global industrial heat sources, 2000 to 2023 (Ma and Wang)',
        use: 'Removing heat that is not fire',
        licence: 'CC BY 4.0',
      },
      naturalearth: { what: 'Country and state borders', use: 'Finding places by name', licence: 'Public domain' },
      noaa: {
        what: 'El Niño (ONI) and Indian Ocean Dipole (DMI) indices',
        use: 'Drivers of unusual months and the outlook',
        licence: 'Public domain',
      },
      basemap: {
        what: 'Base map tiles (OpenFreeMap, with OpenStreetMap data)',
        use: 'The map background',
        licence: 'ODbL, © OpenStreetMap contributors',
      },
    },
    citeTitle: 'How to cite',
    citeIntro: 'Please cite Fire Harmony and NASA FIRMS when you use these data or pictures.',
    citeOthers: 'If you use the land cover, peat, population or border facts in cells.parquet, please cite those sources too.',
    filesTitle: 'Files',
    filesIntro: 'All files are open. DuckDB can read the Parquet files in place, so you only download the parts you need.',
    columnsTitle: 'Columns',
    columns: [
      { name: 'yr, mo', text: 'Year and month.' },
      { name: 'h', text: 'Harmonized hotspots per month, on the NOAA-20 VIIRS scale.' },
      { name: 'modis', text: 'The same on the MODIS scale (one satellite, the average of Terra and Aqua).' },
      { name: 't, a, s, n, j', text: 'Raw detections of Terra, Aqua, Suomi NPP, NOAA-20 and NOAA-21.' },
      { name: 'src', text: 'Source: 0 VIIRS observed, 1 model from MODIS Terra + Aqua, 2 model from MODIS Terra only, 3 no data yet.' },
      { name: 'h3', text: 'H3 hexagon index, as hex text.' },
      { name: 'median, q25, q75', text: 'The normal for that calendar month over 2001 to 2025, and the middle half of the years.' },
    ],
    zeroNote: 'A hexagon month that is missing from a file had no fire (value 0), except in months with source 3 (no data yet).',
    monthsNote: (first, last) => `Months run from ${first} to ${last}. The archive starts in November 2000, so the calendar starts in 2001. The latest month is usually partial.`,
    codeTitle: 'Code',
    code: 'The code is open source under the Apache 2.0 licence.',
  },
  panels: {
    calendarLabel: (name) => `Burning calendar of ${name}`,
    noData: 'no data yet',
    hotspots: 'hotspots',
    normal: 'normal',
    timesNormal: (r) => `${r} times normal`,
    kpiMonth: 'Latest full month',
    kpiYear: (m) => `This year to ${m}`,
    kpiTrend: 'Trend since 2001',
    kpiCritical: 'Critical period',
    above: 'Above normal',
    below: 'Below normal',
    nearNormal: 'Near normal',
    rank: (r, n, m) => `${ordinal(r)} highest ${m} in ${n} years`,
    percentile: (p) => `higher than ${p} of years`,
    increasing: 'Rising',
    decreasing: 'Falling',
    noTrend: 'No clear trend',
    notEnough: 'Not enough years',
    perDecade: (pct) => `${pct} per decade`,
    pValue: (p) => `p = ${p}`,
    criticalNone: 'No month stands out',
    chartYearly: 'Hotspots per year',
    chartRange: '90% range where modelled',
    modisScale: 'MODIS scale',
    harmonizedLabel: 'Harmonized',
    sensors: { t: 'Terra (MODIS)', a: 'Aqua (MODIS)', s: 'Suomi NPP (VIIRS)', n: 'NOAA-20 (VIIRS)', j: 'NOAA-21 (VIIRS)' },
    briefTitle: 'Fire brief',
    partialYear: 'so far',
  },
  drivers: {
    title: (m) => `Why was ${m} unusual?`,
    loading: 'Loading the drivers…',
    error: 'The drivers could not be loaded.',
    noModel: 'This area has too little fire for a driver model, so we cannot say which weather drove it.',
    drawnArea: 'Drivers and the outlook are shown for named places. Pick a country or a state to see them.',
    fire: 'Fire',
    rain: 'Rain, this month and the 2 before',
    heat: 'Air temperature',
    enso: 'El Niño index (ONI)',
    fireWeather: 'Fire weather index',
    pctBelow: (p) => `${p} below normal`,
    pctAbove: (p) => `${p} above normal`,
    aboutNormal: 'about normal',
    warmer: (d) => `${d} °C warmer than normal`,
    cooler: (d) => `${d} °C cooler than normal`,
    ensoState: { strongNino: 'strong El Niño', nino: 'El Niño', nina: 'La Niña', strongNina: 'strong La Niña', neutral: 'neutral' },
    notYet: 'no data yet',
    fwiNote: 'Fire weather data run to April 2026.',
    heatNotDriver: 'In past years heat did not raise fire here, so it is left out.',
    rainPoints: (x) => `The rain alone points to ${x} times normal fire.`,
    rainPointsHigh: 'The rain alone points to more than 10 times normal fire. In droughts this dry, fire grows less than the simple model says.',
    offSeason: 'This month is outside the fire season here, so we do not estimate fire from the rain.',
    bothPoint: (x) => `With the heat, it points to ${x} times normal.`,
    bothPointHigh: 'With the heat, it points to more than 10 times normal.',
    actual: (x) => `Fire was ${x} times normal.`,
    skill: (pct) => `On years the model never saw, these drivers explained ${pct} of the ups and downs of fire here.`,
    lowSkill: 'Here the weather explains little of the ups and downs of fire, so read these numbers as context.',
    ensoDry: (lag) => (lag === 0 ? 'El Niño usually brings drought here in the same months.' : `El Niño usually brings drought here about ${lag} months later.`),
    ensoWet: (lag) => (lag === 0 ? 'El Niño usually brings more rain here in the same months.' : `El Niño usually brings more rain here about ${lag} months later.`),
    titleQuiet: (m) => `Why was ${m} quiet?`,
    titleNormal: (m) => `Was ${m} unusual?`,
    subtitle: 'Fire and the weather behind it, each against its normal for that month',
    pointsTitle: 'What the weather points to',
    noMonth: (m) => `There are no driver data for ${m} yet.`,
    drawnTitle: 'Why months are unusual',
    latestOf: (label, m) => `${label}, ${m}`,
    notOut: (what, m) => {
      const list = what.length <= 1 ? what.join('') : `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}`;
      const text = `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
      return `${text} for ${m} ${what.length > 1 ? 'are' : 'is'} not out yet.`;
    },
    showLatest: (m) => `Show ${m}, the latest month with every driver`,
    shortNames: { heat: 'heat', enso: 'El Niño', fireWeather: 'fire weather', rain: 'rain', fire: 'fire' },
    pointsTo: {
      rain: (vs) => `The rain alone points to fire ${vs}.`,
      both: (vs) => `With the heat, it points to fire ${vs}.`,
      actual: (vs) => `Fire was ${vs}.`,
    },
    fwiTo: (m) => `Fire weather data run to ${m}.`,
  },
  outlook: {
    title: 'Fire outlook',
    issued: (m) => `From the data to ${m}`,
    loading: 'Loading the outlook…',
    error: 'The outlook could not be loaded.',
    none: 'No outlook for this area now. Either the next three months are outside its fire season, or it has too little fire.',
    chance: 'Chance of above normal fire',
    normalChance: (p) => `normal chance ${p}`,
    skillLabel: { good: 'Useful in past tests', some: 'Some skill in past tests', none: 'No better than the normal chance in past tests' },
    note: 'Above normal means more fire than in half of the years 2001 to 2025 for that month. The outlook is given for months of the fire season only. The skill comes from years the model never saw.',
    subtitle: (m) => `Chance of above normal fire in each of the next three months, from the data to ${m}`,
    chanceOf: 'chance of above normal fire',
    normalChanceLine: (p) => `Normal chance ${p}`,
    drawnArea: 'The outlook is given for named places. Pick a country or a state to see it.',
    headline: (p, m) => `${p} chance of an above normal ${m}`,
    pastAbove: (p) => `In past years: above normal in ${p} of these months`,
    offSeason: (m, n) => `${m}: outside the fire season the outlook covers. Usually about ${n} hotspots.`,
    offSeasonNone: (m) => `${m}: outside the fire season the outlook covers. Usually no fire.`,
    subtitle3: (m) => `The next three months, from the data to ${m}`,
    forState: (state, city) => `Outlook for ${state}, the state around ${city}`,
    noState: 'The outlook is given for named places. This circle is not in a state we know, so pick a country or a state to see it.',
  },
  haze: {
    title: 'Haze from fires upwind',
    lead: 'How much of the smoke in a city comes from fires in Sumatra and in Borneo, month by month in the fire season (July to November).',
    city: 'City',
    loading: 'Loading the haze data…',
    error: 'The haze data could not be loaded.',
    chartTitle: (c) => `Fine particles (PM2.5) in ${c}, July to November`,
    chartSub: 'Monthly mean, micrograms per cubic metre',
    observed: 'Satellite based (MERRA-2, bias corrected)',
    model: 'Normal level plus smoke from the fires (our model)',
    merra2: 'MERRA-2, not corrected',
    who: 'WHO daily guideline',
    sourcesTitle: (c) => `Where the smoke in ${c} comes from`,
    sourcesSub: 'Smoke from fires, mean of July to November in each year',
    sumatra: 'Sumatra',
    borneo: 'Borneo',
    shareLine: (c, s, b) => `In the fire seasons of 2002 to 2025, ${s} of the smoke from fires in ${c} came from Sumatra and ${b} from Borneo.`,
    skillLine: (pct) => `On years left out, the fires explain ${pct} of the ups and downs of PM2.5 here.`,
    perThousand: (src, ug) => `Every 1,000 more hotspots in ${src} add about ${ug} micrograms per cubic metre to the monthly mean.`,
    latest: (m, model, smoke) => `${m}: our model gives ${model}, of which ${smoke} is smoke from the fires.`,
    daysLine: (d, m) => `${d} days above the WHO daily guideline in ${m}.`,
    methodTitle: 'How we did it',
    method: [
      'Smoke adds up. So for each city, the monthly PM2.5 is a normal level for the month plus an amount for every 1,000 hotspots in Sumatra and in Borneo (Kalimantan, Sarawak, Sabah and Brunei). The amounts cannot be below zero.',
      'We fit this on the fire seasons of 2002 to 2025, with bias corrected PM2.5 from NASA MERRA-2 and our harmonized hotspots, and we test it on years left out.',
      'For 2026 there is no bias corrected PM2.5 yet, so the model estimates it from the fires. Uncorrected MERRA-2 is shown for comparison.',
    ],
    limitsTitle: 'Limits',
    limits: [
      'Monthly means hide the worst days. The days above the WHO daily guideline are counted from the daily data.',
      'A city takes the PM2.5 of the grid cell it lies in (about 55 by 70 km). Johor Bahru and Singapore share one cell.',
      'Fires in Peninsular Malaysia are small and burn in the same years as in Sumatra, so their part cannot be told apart.',
    ],
  },
  footer: {
    line: 'Fire Harmony, for the NASA Space Apps Challenge 2026. Hotspots from NASA FIRMS.',
    dataVersion: (version, built) => `Data version ${version}, built ${built}.`,
  },
};

// DRAFT: Bahasa Melayu. Written with care; a native speaker still has to review it before release.
export const DICTS: Record<Lang, Dict> = { en };

/** The citation is kept in English in every language (it is a reference, not interface text). */
export function citation(version: string): string {
  return `Fire Harmony (2026). One consistent worldwide fire hotspot record from MODIS and VIIRS, version ${version}. NASA Space Apps Challenge 2026.`;
}

/** NASA FIRMS asks users to acknowledge it with this sentence. */
export const FIRMS_ACKNOWLEDGEMENT =
  'We acknowledge the use of data from NASA’s Fire Information for Resource Management System (FIRMS), part of NASA’s Earth Science Data and Information System (ESDIS).';

// ---------------------------------------------------------------------------------------------------------------
// Language state shared through React context. App.tsx provides it; any component can read it with useI18n().

export interface I18n { lang: Lang; t: Dict; setLang: (lang: Lang) => void }

export const I18nContext = createContext<I18n>({ lang: 'en', t: en, setLang: () => undefined });

export function useI18n(): I18n {
  return useContext(I18nContext);
}

const STORAGE_KEY = 'fire_harmony_lang';

function isLang(value: unknown): value is Lang {
  return value === 'en';
}

/** The saved choice, else the browser language, else English. */
export function initialLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Storage can be blocked (private mode); fall back to the browser language.
  }
  return 'en';
}

export function storeLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not saved; the choice still holds for this visit.
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Formatting helpers

const numberFormats = new Map<string, Intl.NumberFormat>();

export function formatNumber(value: number, lang: Lang, digits = 0): string {
  const key = `${lang}:${digits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(DICTS[lang].locale, { maximumFractionDigits: digits });
    numberFormats.set(key, format);
  }
  return format.format(value);
}

export function formatMonth(yr: number, mo: number, lang: Lang): string {
  return `${DICTS[lang].common.months[mo - 1] ?? String(mo)} ${yr}`;
}

/** yyyymm (for example 202610) as "October 2026". */
export function formatYyyymm(yyyymm: number, lang: Lang): string {
  return formatMonth(Math.floor(yyyymm / 100), yyyymm % 100, lang);
}

export function formatCoord(lat: number, lon: number, lang: Lang): string {
  const h = DICTS[lang].common.hemi;
  const latText = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? h.n : h.s}`;
  const lonText = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? h.e : h.w}`;
  return `${latText}, ${lonText}`;
}

/** Display name of a named place. A few small places have no name in the data: use their code. */
export function areaName(area: NamedArea, lang: Lang): string {
  if (area.kind === 'world') return DICTS[lang].common.world;
  const name: string | null = area.name;
  return name !== null && name.trim() !== '' ? name : area.id;
}

function ringCentre(ring: readonly [number, number][]): [number, number] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = ring.length > 1 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
  const points = closed ? ring.slice(0, -1) : ring;
  if (points.length === 0) return [0, 0];
  let lon = 0;
  let lat = 0;
  for (const [x, y] of points) {
    lon += x;
    lat += y;
  }
  return [lon / points.length, lat / points.length];
}

/** Short label of any selection, in the given language. */
export function selectionLabel(sel: AreaSelection, lang: Lang): string {
  const t = DICTS[lang];
  switch (sel.type) {
    case 'named':
      return areaName(sel.area, lang);
    case 'polygon': {
      if (sel.label) return sel.label;
      const [lon, lat] = ringCentre(sel.ring);
      return t.common.areaNear(formatCoord(lat, lon, lang));
    }
    case 'circle':
      return t.common.circle(formatNumber(sel.radiusKm, lang, 1), formatCoord(sel.lat, sel.lon, lang));
  }
}

/** Plain size of a selection in km², when it is known without a query. */
export function selectionAreaKm2(sel: AreaSelection): number | null {
  if (sel.type === 'named') return sel.area.area_km2 > 0 ? sel.area.area_km2 : null;
  if (sel.type === 'circle') return Math.PI * sel.radiusKm * sel.radiusKm;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Counts, ratios and sizes in plain words (Explorer)

/** A count in plain words: 3.4, 812, 15,200, 1.33 million. */
export function formatCountWords(v: number, lang: Lang): string {
  const { value, unit } = countParts(v, lang);
  return unit ? `${value} ${unit}` : value;
}

/** A count split for a stat tile: 1,330,000 → { value: '1.33', unit: 'million' }; 15,200 → { value: '15,200', unit: '' }. */
export function countParts(v: number, lang: Lang): { value: string; unit: string } {
  const locale = DICTS[lang].locale;
  if (Math.abs(v) >= 1e6) {
    return { value: new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(v / 1e6), unit: 'million' };
  }
  if (Math.abs(v) >= 1e4) return { value: new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(v), unit: '' };
  return { value: new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 }).format(v), unit: '' };
}

/** A short count for axes and colour bars: 0.5, 250, 1,500, 640K, 1.3M (capital K and M, as on most charts). */
export function formatCompact(v: number, lang: Lang): string {
  const locale = DICTS[lang].locale;
  if (Math.abs(v) >= 10_000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 2 }).format(v);
  if (Math.abs(v) >= 10) return new Intl.NumberFormat(locale, { maximumSignificantDigits: 2 }).format(v);
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 1 }).format(v);
}

/** A ratio for "x times normal": 2.4, 0.9, 12. */
export function formatRatio(r: number, lang: Lang): string {
  return formatNumber(r, lang, r < 10 ? 1 : 0);
}

/** A ratio limit for the colour bar: 1.25×, 0.8×, 4×, 0.25×. */
export function formatTimes(r: number, lang: Lang): string {
  return `${new Intl.NumberFormat(DICTS[lang].locale, { maximumSignificantDigits: 2 }).format(r)}×`;
}

/** A size: 2.39 million km², 153,000 km², 7,850 km². */
export function formatArea(km2: number, lang: Lang): string {
  const locale = DICTS[lang].locale;
  if (km2 >= 1e6) return `${new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(km2 / 1e6)} million km²`;
  return `${new Intl.NumberFormat(locale, { maximumSignificantDigits: km2 >= 1000 ? 3 : 2 }).format(km2)} km²`;
}

/** A signed percent per decade: +4%, −6%, 0%. */
export function formatSignedPercent(pct: number, lang: Lang): string {
  return new Intl.NumberFormat(DICTS[lang].locale, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' })
    .format(pct / 100).replace('-', '−');
}
