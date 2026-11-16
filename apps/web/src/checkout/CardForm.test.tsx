import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CardForm } from './CardForm';

function setup() {
  const onSubmit = vi.fn(() => Promise.resolve());
  const onEdit = vi.fn();
  render(<CardForm payLabel="Pay" disabled={false} onSubmit={onSubmit} onEdit={onEdit} />);
  return { onSubmit, onEdit, user: userEvent.setup() };
}

describe('CardForm input helpers', () => {
  it('groups the card number and caps it at 16 digits', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Card number'), '42424242424242421234');
    expect(screen.getByLabelText('Card number')).toHaveValue('4242 4242 4242 4242');
  });

  it('formats the expiry as you type', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Expiry (MM/YY)'), '1225');
    expect(screen.getByLabelText('Expiry (MM/YY)')).toHaveValue('12/25');
  });

  it('pads a first digit above 1 with a zero and slash', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Expiry (MM/YY)'), '4');
    expect(screen.getByLabelText('Expiry (MM/YY)')).toHaveValue('04/');
  });

  it('backspace on the slash removes it and the last month digit', async () => {
    const { user } = setup();
    const input = screen.getByLabelText('Expiry (MM/YY)');
    await user.type(input, '12');
    expect(input).toHaveValue('12/');
    await user.keyboard('{Backspace}');
    expect(input).toHaveValue('1');
  });

  it('ignores letters in the security code', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Security code'), 'abc');
    expect(screen.getByLabelText('Security code')).toHaveValue('');
  });

  it('still reports edits', async () => {
    const { user, onEdit } = setup();
    await user.type(screen.getByLabelText('Security code'), '1');
    expect(onEdit).toHaveBeenCalled();
  });
});
