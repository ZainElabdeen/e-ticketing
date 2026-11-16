import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TicketStub } from './TicketStub';

describe('TicketStub', () => {
  it('shows the tier eyebrow', () => {
    render(
      <TicketStub tier="GOLD" stub={<span>stub</span>}>
        body
      </TicketStub>,
    );
    expect(screen.getByText('Admit one · Gold')).toBeInTheDocument();
  });

  it('uses a custom eyebrow', () => {
    render(
      <TicketStub tier="GOLD" eyebrow="Your order" stub={<span>stub</span>}>
        body
      </TicketStub>,
    );
    expect(screen.getByText('Your order')).toBeInTheDocument();
    expect(screen.queryByText(/Admit one/)).toBeNull();
  });

  it('NEUTRAL has no default eyebrow', () => {
    render(
      <TicketStub tier="NEUTRAL" stub={<span>stub</span>}>
        body
      </TicketStub>,
    );
    expect(screen.queryByText(/Admit one/)).toBeNull();
  });
});
