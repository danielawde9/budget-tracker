import type { ReactNode } from 'react';
import type { Locale } from '../loans/types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

/** Screen-reader-only live loading text paired with decorative skeleton blocks. */
export function SkeletonStatus({ locale }: { locale: Locale }) {
  return (
    <p className="cr-visually-hidden" role="status">
      {t(locale, 'Loading…', 'جارٍ التحميل…')}
    </p>
  );
}

function Skeleton({ shape }: { shape: string }) {
  return <span className={`cr-skeleton cr-skeleton--${shape}`} aria-hidden="true" />;
}

function SkeletonCard({ children }: { children: ReactNode }) {
  return (
    <div className="cr-skeleton-card" aria-hidden="true">
      {children}
    </div>
  );
}

function SkeletonChips({ count }: { count: number }) {
  return (
    <div className="cr-skeleton-chips" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <Skeleton key={index} shape="chip" />)}
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => <Skeleton key={index} shape="row" />)}
    </>
  );
}

/** Mirrors the Home layout: net-position hero + chips, budget card, trend card, activity card. */
export function HomeSkeleton({ locale }: { locale: Locale }) {
  return (
    <>
      <SkeletonStatus locale={locale} />
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <Skeleton shape="hero" />
        <div className="cr-skeleton-chips">
          <Skeleton shape="chip" />
          <Skeleton shape="chip" />
        </div>
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <SkeletonRows count={3} />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <Skeleton shape="bar" />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <SkeletonRows count={2} />
      </SkeletonCard>
    </>
  );
}

/** Mirrors the journal feed while the first page of events loads. */
export function JournalSkeleton({ locale, rows = 6 }: { locale: Locale; rows?: number }) {
  return (
    <>
      <SkeletonStatus locale={locale} />
      <SkeletonChips count={3} />
      <SkeletonCard>
        <SkeletonRows count={rows} />
      </SkeletonCard>
    </>
  );
}

/** Mirrors the plan page: income summary cards + category target rows. */
export function PlanSkeleton({ locale }: { locale: Locale }) {
  return (
    <>
      <SkeletonStatus locale={locale} />
      <SkeletonChips count={2} />
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <Skeleton shape="hero" />
        <Skeleton shape="line" />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <SkeletonRows count={4} />
      </SkeletonCard>
    </>
  );
}
