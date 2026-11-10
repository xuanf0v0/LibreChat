import { useId } from 'react';
import { Label, labelVariants } from '@librechat/client';
import type { ReactNode } from 'react';
import { cn } from '~/utils';

/**
 * One block in a builder panel: a section heading, at most one inline action,
 * and the body. Every section used the same heading/action/spacing recipe in
 * its own words, so the panel read as several designs stacked; the recipe lives
 * here once. Field labels stay `Label`s — only sections use the eyebrow style.
 *
 * `htmlFor` keeps the heading a real `<label>` when the section heads a single
 * control (conversation starters); otherwise the heading is an `h3` and names
 * the section through `aria-labelledby`.
 */
export default function PanelSection({
  title,
  action,
  htmlFor,
  id,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  htmlFor?: string;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const autoId = useId();
  const headingId = id ?? autoId;

  return (
    <section
      className={cn('mb-4 flex flex-col gap-2', className)}
      {...(htmlFor ? {} : { 'aria-labelledby': headingId })}
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        {htmlFor ? (
          <Label variant="section" id={headingId} htmlFor={htmlFor}>
            {title}
          </Label>
        ) : (
          <h3 id={headingId} className={labelVariants({ variant: 'section' })}>
            {title}
          </h3>
        )}
        {action != null && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
      {children}
    </section>
  );
}
