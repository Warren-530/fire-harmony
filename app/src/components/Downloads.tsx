// Downloads of the selected area, from one Download button in the panel's header (so no tab is ever cut off): the
// monthly record as CSV (with the 90% range and the normal), the hotspots of a period (in the Period tab, where the
// months are picked), pictures of the burning calendar and of the yearly chart (PNG, made from the data, so they
// work from any tab), and the open data files (a dialog). Every save is confirmed with a toast.
//
// The menu follows the menu button pattern: Enter, Space or the down arrow open it on the first item, the arrows,
// Home and End move, Escape closes it and gives the focus back to the button.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { downloadUrl } from '../lib/config';
import { citation, formatMonth, useI18n, type Dict, type FileKey, type Lang } from '../lib/i18n';
import { monthlyCsv, onScale, type FamilyTest } from '../lib/stats';
import type { ColourMode, Meta, MonthlyPoint, Scale } from '../lib/types';
import { onPressOutside } from './explorer/dismiss';
import { calendarPng, chartPng, saveBlob, slug } from './explorer/exportImages';
import { calendarTitle } from './explorer/months';
import { compareChart, compareColours, shortNames, yearlyChart, type CompareMode, type CompareSeries } from './SeriesChart';
import { useToast } from './Toast';
import { Tooltip } from './Tooltip';
import { IconCalendar, IconChart, IconChevronDown, IconClose, IconDatabase, IconDownload, IconExternal, IconFlame } from './icons';

const FILES: Record<Exclude<FileKey, 'l5'>, string> = {
  meta: 'meta.json', areas: 'areas.json', area_monthly: 'area_monthly.parquet', cells: 'cells.parquet',
  map_l3: 'map_l3.parquet', map_l4: 'map_l4.parquet', cell_l3: 'cell_l3.parquet', cell_l4: 'cell_l4.parquet',
  clim_l3: 'clim_l3.parquet', clim_l4: 'clim_l4.parquet', drivers: 'drivers.parquet', drivers_models: 'drivers_models.parquet',
  outlook: 'outlook.parquet', haze: 'haze.parquet', haze_json: 'haze.json', dashboard: 'dashboard.json',
};

/** Save the monthly record of an area as CSV; returns the file name. Used by the menu and the command palette. */
export function saveCsv(name: string, points: readonly MonthlyPoint[], meta: Meta, t: Dict): string {
  const file = `fire_harmony_${slug(name)}.csv`;
  const text = monthlyCsv(name, points, meta, { citation: citation(meta.version), sourceLabel: (s) => t.common.sources[s] });
  saveBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), file);
  return file;
}

/** Save the burning calendar of an area as a PNG (the menu and the full calendar's own button); returns the file name. */
export async function saveCalendarPicture(o: { name: string; points: readonly MonthlyPoint[]; scale: Scale; mode: ColourMode; lastYear: number;
  t: Dict; lang: Lang }): Promise<string> {
  const { name, points, scale, mode, lastYear, t, lang } = o;
  const blob = await calendarPng({
    points: onScale(points, scale), mode, t, lang,
    title: calendarTitle(points, t), subtitle: t.downloads.calendarSub(name, 2001, lastYear),
    legendTitle: mode === 'count' ? t.explorer.legend[scale] : t.explorer.legend.anomaly, source: t.downloads.imageSource,
  });
  const file = `fire_harmony_${slug(name)}_calendar.png`;
  saveBlob(blob, file);
  return file;
}

function sizeOf(meta: Meta, key: string, t: Dict): string {
  const f = (meta.files as Record<string, unknown>)[key] as { mb?: number } | undefined;
  return typeof f?.mb === 'number' ? t.downloads.sizeMb(new Intl.NumberFormat(t.locale, { maximumFractionDigits: f.mb < 1 ? 2 : 1 }).format(f.mb)) : '';
}

export interface DownloadsProps {
  name: string;                           // the area's name, for the files and the subtitles ("World")
  sentence: string;                       // the same inside a sentence, for the titles ("the world")
  points: readonly MonthlyPoint[] | null; // as loaded (harmonized, MODIS scale and raw detections); null while loading
  scale: Scale;
  mode: ColourMode;
  meta: Meta;
  family?: FamilyTest | null;             // the trend test among all the places of its kind (the chart's title)
  compare?: { series: readonly CompareSeries[]; mode: CompareMode } | null;   // the places pinned to compare, as the panel shows them
}

/** The open data files, each with its size and what it holds. */
export function DataFiles({ meta }: { meta: Meta }) {
  const { t } = useI18n();
  const d = t.downloads;
  return (
    <ul className="fh-ex-files">
      {(Object.keys(FILES) as (keyof typeof FILES)[]).map((k) => (
        <li key={k}>
          <a href={downloadUrl(FILES[k])} download className="fh-ex-file">
            <span className="ui-mono">{FILES[k]}</span>
            <span className="fh-ex-file-size ui-mono">{sizeOf(meta, k, t)}</span>
            <IconExternal size={14} />
          </a>
          <span className="fh-ex-file-about">{d.files[k]}</span>
        </li>
      ))}
      <li>
        <span className="fh-ex-file"><span className="ui-mono">l5/</span><span className="fh-ex-file-size ui-mono">{d.l5Files(String(meta.files.l5.files))}</span></span>
        <span className="fh-ex-file-about">{d.files.l5}</span>
      </li>
    </ul>
  );
}

/** The saves of the area: the CSV and the two pictures. */
function useSaves({ name, sentence, points, scale, mode, meta, family = null, compare = null }: DownloadsProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<'calendar' | 'chart' | 'compare' | null>(null);
  const lastYear = points && points.length ? points[points.length - 1].yr : Math.floor(meta.last_month / 100);
  const csv = () => {
    if (!points) return;
    try { saveCsv(name, points, meta, t); toast(t.ex.toasts.csv); } catch { toast(t.ex.toasts.failed, 'info'); }
  };
  const calendar = async () => {
    if (!points) return;
    setBusy('calendar');
    try {
      await saveCalendarPicture({ name, points, scale, mode, lastYear, t, lang });
      toast(t.ex.toasts.png);
    } catch { toast(t.ex.toasts.failed, 'info'); } finally { setBusy(null); }
  };
  const chart = async () => {
    if (!points) return;
    setBusy('chart');
    try {
      const blob = await chartPng(yearlyChart(points, scale, meta, [2001, lastYear], sentence, t, lang, false, family));
      saveBlob(blob, `fire_harmony_${slug(name)}_chart.png`);
      toast(t.ex.toasts.png);
    } catch { toast(t.ex.toasts.failed, 'info'); } finally { setBusy(null); }
  };
  // the comparison as the panel shows it: one line per place in the compare colours, the names in the title and the keys
  const comparing = !!compare && compare.series.filter((x) => x.points).length >= 2;
  const comparison = async () => {
    if (!compare || !comparing) return;
    setBusy('compare');
    try {
      const shown = compare.series.filter((x) => x.points);
      const lastYr = Math.max(...shown.map((x) => { const p = x.points ?? []; return p.length ? p[p.length - 1].yr : 2026; }));
      const chartOf = compareChart(shown, [2001, lastYr], compare.mode, compareColours(shown), t, lang);
      const blob = await chartPng(chartOf);
      saveBlob(blob, `fire_harmony_compare_${slug(shortNames(shown.map((x) => x.name)).join(' '))}.png`);
      toast(t.ex.toasts.png);
    } catch { toast(t.ex.toasts.failed, 'info'); } finally { setBusy(null); }
  };
  return { csv, calendar, chart, comparison, comparing, busy, ready: !!points && points.length > 0 };
}

interface Item { key: string; icon: ReactNode; label: string; hint: string; disabled?: boolean; run: () => void }

/** The Download button of the panel header and its menu. `onHotspots` opens the Period tab's hotspot download. */
export function DownloadMenu(props: DownloadsProps & { onHotspots: () => void; compact?: boolean }) {
  const { name, points, meta, onHotspots, compact = false } = props;
  const { t, lang } = useI18n();
  const x = t.exPanel.menu;
  const saves = useSaves(props);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const firstFocus = useRef<'first' | 'last'>('first');
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const known = points ? points.filter((p) => p.src !== 3) : [];
  const lastKnown = known.length ? known[known.length - 1].yr * 100 + known[known.length - 1].mo : null;

  const items: Item[] = [
    { key: 'csv', icon: <IconDownload size={17} />, label: x.csv, hint: saves.ready ? x.csvHint : x.waiting, disabled: !saves.ready, run: saves.csv },
    { key: 'hotspots', icon: <IconFlame size={17} />, label: x.hotspots, hint: x.hotspotsHint, run: onHotspots },
    ...(saves.comparing ? [
      { key: 'compare', icon: <IconChart size={17} />, label: saves.busy === 'compare' ? t.downloads.making : t.exPanel.exports.chartCompare,
        hint: t.exPanel.exports.chartCompareHint, disabled: saves.busy !== null, run: () => { void saves.comparison(); } },
      { key: 'chart', icon: <IconChart size={17} />, label: saves.busy === 'chart' ? t.downloads.making : t.exPanel.exports.chartOwn,
        hint: x.pngHint, disabled: !saves.ready || saves.busy !== null, run: () => { void saves.chart(); } },
    ] : [
      { key: 'chart', icon: <IconChart size={17} />, label: saves.busy === 'chart' ? t.downloads.making : x.chart,
        hint: x.pngHint, disabled: !saves.ready || saves.busy !== null, run: () => { void saves.chart(); } },
    ]),
    { key: 'calendar', icon: <IconCalendar size={17} />, label: saves.busy === 'calendar' ? t.downloads.making : x.calendar,
      hint: x.pngHint, disabled: !saves.ready || saves.busy !== null, run: () => { void saves.calendar(); } },
    { key: 'files', icon: <IconDatabase size={17} />, label: x.files, hint: x.filesHint, run: () => dialog.current?.showModal() },
  ];

  const close = useCallback((focus = true) => { setOpen(false); if (focus) button.current?.focus(); }, []);
  // the menu hangs from its button's left edge (the button leads the row of actions), kept inside the window, and
  // opens upwards when there is no room under it
  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const w = menu.current?.offsetWidth ?? 300, h = menu.current?.offsetHeight ?? 300;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const up = b.bottom + 6 + h > vh - 8 && b.top - 6 - h >= 8;
    setPos({ top: up ? b.top - 6 - h : b.bottom + 6, left: Math.max(8, Math.min(b.left, vw - w - 8)), up });
  }, []);
  useLayoutEffect(() => { if (open) place(); else setPos(null); }, [open, place]);
  // once the menu is placed (it is hidden until then), the first (or last) item takes the focus
  const placed = open && pos !== null;
  useEffect(() => {
    if (!placed) return;
    const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    (firstFocus.current === 'last' ? all[all.length - 1] : all[0])?.focus();
  }, [placed]);
  // close on a press outside (which does nothing else: closing the menu over the map picks no hexagon) or a resize
  useEffect(() => {
    if (!open) return undefined;
    const off = onPressOutside(() => [menu.current, button.current], () => close(false));
    const onResize = () => close(false);
    window.addEventListener('resize', onResize);
    return () => { off(); window.removeEventListener('resize', onResize); };
  }, [open, close]);

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      firstFocus.current = e.key === 'ArrowUp' ? 'last' : 'first';
      setOpen(true);
    }
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    let n = -1;
    if (e.key === 'ArrowDown') n = (i + 1) % all.length;
    else if (e.key === 'ArrowUp') n = (i - 1 + all.length) % all.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = all.length - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    else if (e.key === 'Tab') { close(false); return; }
    if (n < 0) return;
    e.preventDefault();
    all[n]?.focus();
  };

  return (
    <>
      <Tooltip content={t.exPanel.tools.downloadTip}>
        <button ref={button} type="button" className={`ui-btn ui-btn-ghost fh-ex-tool${compact ? ' ui-btn-icon' : ''}`}
          aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
          aria-label={compact ? t.exPanel.tools.download : undefined}
          onClick={() => { firstFocus.current = 'first'; setOpen((o) => !o); }} onKeyDown={onButtonKey}>
          <IconDownload size={17} />
          {compact ? null : <><span>{t.exPanel.tools.download}</span><IconChevronDown size={14} className="fh-ex-tool-chev" /></>}
        </button>
      </Tooltip>
      {open && typeof document !== 'undefined' ? createPortal(
        <div ref={menu} id={`${id}-menu`} role="menu" aria-label={x.label} className="fh-ex-menu ui-glass"
          data-up={pos?.up ? '' : undefined} style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }} onKeyDown={onMenuKey}>
          <p className="fh-ex-menu-head" aria-hidden="true">{name}</p>
          {items.map((it, i) => (
            <button key={it.key} type="button" role="menuitem" className="fh-ex-menu-item ui-press" disabled={it.disabled}
              style={{ ['--i' as string]: i }}
              onClick={() => { it.run(); if (it.key !== 'files') close(); else setOpen(false); }}>
              <span className="fh-ex-menu-icon" aria-hidden="true">{it.icon}</span>
              <span className="fh-ex-menu-text"><span className="fh-ex-menu-label">{it.label}</span><span className="fh-ex-menu-hint">{it.hint}</span></span>
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
      <dialog ref={dialog} className="fh-ex-files-dialog ui-glass ui-glass-thick" aria-labelledby={`${id}-files`}
        onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}
        onClose={() => button.current?.focus()}>
        <div className="fh-ex-files-head">
          <h2 id={`${id}-files`}>{t.ex.download.filesTitle}</h2>
          <Tooltip content={x.close}>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" aria-label={x.close} onClick={() => dialog.current?.close()}>
              <IconClose size={17} />
            </button>
          </Tooltip>
        </div>
        <p className="fh-ex-lead">{t.ex.download.lead(name, formatMonth(2000, 11, lang), lastKnown ? formatMonth(Math.floor(lastKnown / 100), lastKnown % 100, lang) : '…')} {t.downloads.filesHelp}</p>
        <DataFiles meta={meta} />
      </dialog>
    </>
  );
}
