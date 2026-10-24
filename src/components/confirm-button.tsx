"use client";

/** Absende-Knopf, der vorher nachfragt – für seltene oder folgenreiche Aktionen. */
export function ConfirmButton({ confirm, children, className = "btn btn-small", name, value, testid }: { confirm: string; children: React.ReactNode; className?: string; name?: string; value?: string; testid?: string }) {
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      data-testid={testid}
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
