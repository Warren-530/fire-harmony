// The fire brief: a few plain sentences written from the numbers (no AI, no server), in an accent card. It tells of
// the month on the map (as the stat tiles do), else of the latest full month. In the Explorer panel it shows three
// lines and opens on request.
import { useMemo, useState } from 'react';
import { fireBrief, littleFire, LITTLE_FIRE_NOTE, type FamilyTest } from '../lib/stats';
import { useI18n } from '../lib/i18n';
import type { Meta, MonthlyPoint } from '../lib/types';
import { Card } from './ui';

export interface FireBriefProps {
  name: string;
  points: readonly MonthlyPoint[];   // harmonized
  meta: Meta;
  ym?: number | null;                // the month on the map (yyyymm); null: the latest full month
  clamp?: boolean;
  family?: FamilyTest | null;        // the place's trend test among all the places of its kind (the trend card's rule)
}

export function FireBrief({ name, points, meta, ym = null, clamp = true, family = null }: FireBriefProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const text = useMemo(() => (points.length ? fireBrief(name, points, 'harmonized', meta, ym, family) : ''), [name, points, meta, ym, family]);
  const little = useMemo(() => littleFire(points), [points]);
  if (!text) return null;
  const long = clamp && text.length > 150;
  return (
    <Card title={t.panels.briefTitle} tone="accent">
      <p className={`fh-ex-brief${long && !open ? ' is-clamped' : ''}`}>{text}</p>
      {long ? (
        <button type="button" className="fh-ex-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? t.ex.readLess : t.ex.readMore}
        </button>
      ) : null}
      {little ? <p className="ui-note fh-ex-little" data-little="">{LITTLE_FIRE_NOTE}</p> : null}
    </Card>
  );
}
