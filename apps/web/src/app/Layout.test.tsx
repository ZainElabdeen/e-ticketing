import { screen } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithApp } from '../test/render';
import { Layout } from './Layout';

function renderApp() {
  return renderWithApp(
    <Routes>
      <Route element={<Layout />}>
        <Route
          path="/"
          element={
            <>
              <h1>Home</h1>
              <Link to="/next">Go next</Link>
              <Link to="/?tab=x">Same page</Link>
            </>
          }
        />
        <Route path="/next" element={<h1>Next page</h1>} />
      </Route>
    </Routes>,
  );
}

describe('Layout focus on navigation', () => {
  it('does not steal focus on the first render', () => {
    renderApp();
    expect(document.body).toHaveFocus();
  });

  it('moves focus to the main region when the pathname changes', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('link', { name: 'Go next' }));
    expect(await screen.findByRole('heading', { name: 'Next page' })).toBeVisible();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('leaves focus alone on a search-param-only change', async () => {
    const { user } = renderApp();
    const link = screen.getByRole('link', { name: 'Same page' });
    await user.click(link);
    expect(link).toHaveFocus();
    expect(screen.getByRole('main')).not.toHaveFocus();
  });
});
