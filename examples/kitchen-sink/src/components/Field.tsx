import { forwardRef } from 'react';

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * One text field. The component is wrapped in forwardRef().
 *
 * The stamp plugin must still place data-component on the root element.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, value, onChange },
  ref,
) {
  return (
    <label className="panel__body">
      {label}
      <input
        ref={ref}
        className="field"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
});
