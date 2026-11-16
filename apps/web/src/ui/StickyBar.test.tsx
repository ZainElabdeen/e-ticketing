import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StickyBar } from './StickyBar';

describe('StickyBar', () => {
  it('renders its children', () => {
    render(
      <StickyBar>
        <button type="button">Checkout</button>
      </StickyBar>,
    );
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeInTheDocument();
  });
});
