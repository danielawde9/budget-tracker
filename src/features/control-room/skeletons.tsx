import type { ReactNode } from 'react';
import type { Locale } from '../loans/types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

/** Screen-reader-only live loading text paired with decorative skeleton blocks. */
export function SkeletonStatus({ locale, text, label }: { locale: Locale; text?: string; label?: string }) {
  const message = text ?? t(locale, 'Loading…', 'جارٍ التحميل…');
  return (
    <p className="cr-visually-hidden" role="status" aria-label={label ?? message}>
      {message}
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

/** Mirrors the wallets page: transaction history on one side, wallet balances on the other. */
export function WalletsSkeleton({ locale }: { locale: Locale }) {
  return (
    <>
      <SkeletonStatus locale={locale} text={t(locale, 'Loading this space’s wallets…', 'جارٍ تحميل محافظ هذه المساحة…')} label="Loading wallets" />
      <div className="wallet-journal-layout">
        <section className="journal data-list">
          <SkeletonCard>
            <Skeleton shape="line-short" />
            <SkeletonRows count={6} />
          </SkeletonCard>
        </section>
        <aside className="wallet-context">
          <SkeletonCard>
            <Skeleton shape="line-short" />
            <SkeletonRows count={3} />
          </SkeletonCard>
        </aside>
      </div>
    </>
  );
}

/** Mirrors the categories page: an income register and an expense register side by side. */
export function CategoriesSkeleton({ locale }: { locale: Locale }) {
  return (
    <>
      <SkeletonStatus locale={locale} text={t(locale, 'Loading this space’s categories…', 'جارٍ تحميل فئات هذه المساحة…')} label={t(locale, 'Loading categories', 'تحميل الفئات')} />
      <div className="category-registers">
        <SkeletonCard>
          <Skeleton shape="line-short" />
          <SkeletonRows count={4} />
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton shape="line-short" />
          <SkeletonRows count={4} />
        </SkeletonCard>
      </div>
    </>
  );
}

/** Mirrors the loans page: summary strip + two direction columns. */
export function LoansSkeleton({ locale }: { locale: Locale }) {
  return (
    <>
      <SkeletonStatus locale={locale} text={t(locale, 'Loading the ledger…', 'جارٍ تحميل الدفتر…')} />
      <SkeletonChips count={3} />
      <div className="loan-columns">
        <SkeletonCard>
          <Skeleton shape="line-short" />
          <SkeletonRows count={3} />
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton shape="line-short" />
          <SkeletonRows count={3} />
        </SkeletonCard>
      </div>
    </>
  );
}

/** Mirrors the household page: header line + a couple of membership rows. */
export function HouseholdSkeleton({ locale, label }: { locale: Locale; label: string }) {
  return (
    <>
      <SkeletonStatus locale={locale} text={label} label={label} />
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <SkeletonRows count={3} />
      </SkeletonCard>
    </>
  );
}

/** Mirrors the goals list: a couple of goal rows under the filter tabs. */
export function GoalsSkeleton({ locale }: { locale: Locale }) {
  return (
    <>
      <SkeletonStatus locale={locale} />
      <SkeletonCard>
        <SkeletonRows count={4} />
      </SkeletonCard>
    </>
  );
}

/** Mirrors a goal's detail: hero progress + milestone/history rows. */
export function GoalDetailSkeleton({ locale }: { locale: Locale }) {
  return (
    <>
      <SkeletonStatus locale={locale} />
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <Skeleton shape="hero" />
        <Skeleton shape="bar" />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <SkeletonRows count={3} />
      </SkeletonCard>
    </>
  );
}

/** Mirrors the allocation setup screen: income hero + category target rows. */
export function AllocationSkeleton({ locale }: { locale: Locale }) {
  return (
    <>
      <SkeletonStatus locale={locale} text={t(locale, 'Loading allocation…', 'جارٍ تحميل التخصيص…')} />
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <Skeleton shape="hero" />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <SkeletonRows count={4} />
      </SkeletonCard>
    </>
  );
}

/** Mirrors the reports page: a couple of period-comparison rows. */
export function ReportsSkeleton({ locale }: { locale: Locale }) {
  return (
    <>
      <SkeletonStatus locale={locale} text={t(locale, 'Loading reports…', 'جارٍ تحميل التقارير…')} />
      <SkeletonCard>
        <SkeletonRows count={2} />
      </SkeletonCard>
    </>
  );
}

/** Mirrors the very first screen: space list still loading before any workspace shell exists. */
export function WorkspaceSkeleton({ locale }: { locale: Locale }) {
  return (
    <div style={{ inlineSize: 'min(360px, 100%)' }}>
      <SkeletonStatus locale={locale} text={t(locale, 'Loading your spaces…', 'جارٍ تحميل مساحاتك…')} />
      <SkeletonChips count={2} />
      <SkeletonCard>
        <Skeleton shape="line-short" />
        <SkeletonRows count={3} />
      </SkeletonCard>
    </div>
  );
}
