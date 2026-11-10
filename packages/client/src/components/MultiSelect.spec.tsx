import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { DialogLayer } from './OriginalDialog';
import MultiSelect from './MultiSelect';

function Picker({ surface }: { surface?: 'default' | 'widget' }) {
  return (
    <MultiSelect
      label="Agents"
      items={['alpha', 'beta']}
      selectedValues={[]}
      setSelectedValues={() => undefined}
      surface={surface}
    />
  );
}

async function openPopover() {
  await userEvent.click(screen.getByRole('combobox'));
  return screen.findByRole('dialog', { name: 'Agents' });
}

describe('MultiSelect surface', () => {
  it('paints the popover with the shared menu surface by default', async () => {
    render(<Picker />);
    const popover = await openPopover();
    expect(popover).toHaveClass('bg-surface-secondary');
    expect(popover).not.toHaveClass('bg-chart-widget-surface');
  });

  it('paints the popover with the dashboard widget surface when asked', async () => {
    render(<Picker surface="widget" />);
    const popover = await openPopover();
    expect(popover).toHaveClass('bg-chart-widget-surface');
    expect(popover).not.toHaveClass('bg-surface-secondary');
  });
});

/**
 * Ariakit portals the listbox to the body, so a popover inside a dialog is
 * stacked against the dialog rather than nested in it. Its own `z-40` loses to
 * the settings panel's z-50, which is how the fetched model list rendered 88
 * options nobody could see.
 */
describe('MultiSelect inside a dialog', () => {
  it('raises the popover above the dialog that contains it', async () => {
    render(
      <DialogLayer>
        <Picker />
      </DialogLayer>,
    );

    const popover = await openPopover();
    expect(Number(popover.style.zIndex)).toBeGreaterThan(50);
  });

  it('leaves the class layer alone outside a dialog', async () => {
    render(<Picker />);
    const popover = await openPopover();
    expect(popover).toHaveClass('z-40');
  });
});
