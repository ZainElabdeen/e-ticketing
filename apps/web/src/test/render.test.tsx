import { createApi, useApi } from '../api/client';
import { call } from '../api/errors';
import { renderWithApp, stubFetch } from './render';

function Probe() {
  useApi();
  return <p>ready</p>;
}

describe('test helpers', () => {
  it('renders inside the providers', () => {
    const { getByText } = renderWithApp(<Probe />);
    expect(getByText('ready')).toBeInTheDocument();
  });

  it('stubFetch answers by method and path and records calls', async () => {
    const f = stubFetch([
      { method: 'GET', path: '/v1/ticket-types', status: 200, body: { data: [] } },
    ]);
    await expect(call(createApi({ fetch: f }).GET('/v1/ticket-types'))).resolves.toEqual({
      data: [],
    });
    expect(f.calls).toHaveLength(1);
  });
});
