import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

export default function TrinityStatus() {
  const localize = useLocalize();
  const { data } = useQuery([QueryKeys.superAgentWorkers, 'trinity-health'], () =>
    dataService.getTrinityHealth(),
  );
  if (data == null || !data.enabled) {
    return null;
  }
  return (
    <section className="border-border-light bg-surface-secondary rounded-xl border p-3">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${data.ok ? 'bg-text-primary' : 'bg-text-destructive'}`}
          aria-hidden="true"
        />
        <span className="text-text-primary text-sm font-medium">
          {localize('com_superagent_trinity')}
        </span>
        <span className="text-text-secondary text-xs">
          {data.ok
            ? localize('com_superagent_trinity_connected')
            : localize('com_superagent_trinity_unavailable')}
        </span>
      </div>
    </section>
  );
}
