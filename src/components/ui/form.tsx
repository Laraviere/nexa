import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from "react";

export function Input({className = "", ...props}: ComponentProps<"input">) {
  return <input {...props} className={`nexa-control ${className}`}/>;
}
export function Select({className = "", ...props}: ComponentProps<"select">) {
  return <select {...props} className={`nexa-control ${className}`}/>;
}
export function Textarea({className = "", ...props}: ComponentProps<"textarea">) {
  return <textarea {...props} className={`nexa-control nexa-textarea ${className}`}/>;
}
// Explicit IDs are stable through server rendering and client hydration. This
// only connects existing validation messages; it does not validate any values.
export function FormField({id, label, required, help, error, className = "", children}: {
  id: string; label: ReactNode; required?: boolean; help?: ReactNode; error?: string;
  className?: string; children: ReactElement<ComponentProps<"input">>;
}) {
  const isRequired = required ?? children.props.required;
  const describedBy = [children.props["aria-describedby"], help ? `${id}-help` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <div className={`min-w-0 ${className}`}>
    <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}{isRequired && <span aria-hidden="true"> *</span>}</label>
    {cloneElement(children, {id, required: isRequired, "aria-invalid": error ? true : children.props["aria-invalid"], "aria-describedby": describedBy})}
    {help && <p id={`${id}-help`} className="mt-1.5 text-xs leading-5 text-secondary">{help}</p>}
    {error && <p id={`${id}-error`} className="mt-1.5 text-sm text-danger">{error}</p>}
  </div>;
}
