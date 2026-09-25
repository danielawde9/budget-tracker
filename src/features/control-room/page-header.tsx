import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="cr-header">
      <div className="cr-header-text">
        <h1>{title}</h1>
        {subtitle ? <p className="cr-helper">{subtitle}</p> : null}
      </div>
      {actions ? <div className="cr-header-actions">{actions}</div> : null}
    </header>
  );
}
