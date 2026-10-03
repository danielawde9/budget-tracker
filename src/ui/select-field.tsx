import { useId, type SelectHTMLAttributes } from 'react';

/**
 * A select whose accessible name is exactly its label. (A select nested inside
 * its <label> gets the selected option folded into its name.)
 */
export function SelectField({ label, hideLabel = false, ...select }: { readonly label: string; readonly hideLabel?: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="cr-field">
      <label htmlFor={id} className={hideLabel ? 'cr-visually-hidden' : 'cr-label'}>{label}</label>
      <select id={id} {...select} />
    </div>
  );
}
