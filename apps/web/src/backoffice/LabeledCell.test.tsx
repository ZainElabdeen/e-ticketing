import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LabeledCell } from './LabeledCell';

function renderCell(children?: React.ReactNode): HTMLElement {
  render(
    <table>
      <tbody>
        <tr>
          <LabeledCell label="Amount">{children}</LabeledCell>
        </tr>
      </tbody>
    </table>,
  );
  return screen.getByRole('cell');
}

describe('LabeledCell', () => {
  it('renders an aria-hidden label before the value', () => {
    const cell = renderCell('AED 700.00');
    const label = cell.querySelector('span');
    expect(label).toHaveAttribute('aria-hidden', 'true');
    expect(label).toHaveTextContent('Amount');
    expect(cell).toHaveTextContent('AmountAED 700.00');
  });

  it.each<[string, React.ReactNode]>([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('renders no label for an empty cell (%s)', (_name, value) => {
    expect(renderCell(value).textContent).toBe('');
  });
});
