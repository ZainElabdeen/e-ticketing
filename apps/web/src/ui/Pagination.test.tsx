import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';

function Harness(props: { onPage: (p: number) => void }): ReactElement {
  const [page, setPage] = useState(1);
  return (
    <Pagination
      page={page}
      total={40}
      pageSize={20}
      onPage={(p) => {
        props.onPage(p);
        setPage(p);
      }}
    />
  );
}

describe('Pagination', () => {
  it('keeps focus on Next when it reaches the last page, and ignores further clicks', async () => {
    const onPage = vi.fn();
    const user = userEvent.setup();
    render(<Harness onPage={onPage} />);
    const next = screen.getByRole('button', { name: 'Next' });
    await user.click(next);
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute('aria-disabled', 'true');
    await user.click(next);
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('does not go before the first page', async () => {
    const onPage = vi.fn();
    const user = userEvent.setup();
    render(<Harness onPage={onPage} />);
    const prev = screen.getByRole('button', { name: 'Prev' });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    await user.click(prev);
    expect(onPage).not.toHaveBeenCalled();
  });

  it('announces the page label politely', () => {
    render(<Harness onPage={vi.fn()} />);
    const label = screen.getByText('Page 1 of 2');
    expect(label).toHaveAttribute('aria-live', 'polite');
    expect(label).toHaveAttribute('aria-atomic', 'true');
  });
});
