import { webcrypto } from 'node:crypto';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { I18nProvider } from '../lib/i18n.tsx';
import { fakeApi, fixtures } from '../test/harness.tsx';
import { OAuthConsent } from './oauth-consent.tsx';

const connectionId='d851d49f-5b15-4bfd-9a2d-63b0a76545fa';
afterEach(()=>vi.unstubAllGlobals());
function setup(failGrant=false){
  vi.stubGlobal('crypto',webcrypto);
  const fetcher=vi.fn(async (_url:string,init?:RequestInit)=>Response.json(init?.method==='POST'?{redirectTo:'http://localhost:1455/callback?code=abc'}:{clientId:'codex-client',clientName:'Codex',redirectUri:'http://localhost:1455/callback',redirectIsLoopback:true,scope:['budget:read','budget:write']}));
  vi.stubGlobal('fetch',fetcher);
  const api=fakeApi({mcpGrantClient:async()=>{if(failGrant)throw Error('offline');return {ok:true};}});
  const redirect=vi.fn();
  render(<I18nProvider locale="en"><OAuthConsent api={api} connectionId={connectionId} onRedirect={redirect}/></I18nProvider>);
  return {api,redirect,fetcher};
}
it('waits for consent and binds the displayed client/space with only credential hashes',async()=>{
  const {api,redirect,fetcher}=setup();
  await screen.findByText('Codex');
  expect(api.mcpGrantClient).not.toHaveBeenCalled();
  await userEvent.setup().selectOptions(screen.getByLabelText('Budget space'),fixtures.spaces[0]!.id);
  await userEvent.setup().click(screen.getByRole('button',{name:'Connect and allow direct saves'}));
  await vi.waitFor(()=>expect(redirect).toHaveBeenCalledWith('http://localhost:1455/callback?code=abc'));
  expect(api.mcpGrantClient).toHaveBeenCalledWith('codex-client',fixtures.spaces[0]!.id,'Codex',expect.stringMatching(/^[a-f0-9]{64}$/),expect.stringMatching(/^[a-f0-9]{64}$/));
  const post=fetcher.mock.calls.find(c=>c[1]?.method==='POST')!;
  const submitted=JSON.parse(String(post[1]!.body));
  expect(submitted.decision).toBe('approve');
  expect(submitted.grantToken).not.toBe(api.mcpGrantClient.mock.calls[0]![3]);
});
it('does not complete OAuth when persisting the restricted grant fails',async()=>{
  const {fetcher,redirect}=setup(true);
  await userEvent.setup().click(await screen.findByRole('button',{name:'Connect and allow direct saves'}));
  await screen.findByRole('alert');
  expect(fetcher.mock.calls.some(c=>c[1]?.method==='POST')).toBe(false);
  expect(redirect).not.toHaveBeenCalled();
});
it('denies without creating a grant',async()=>{
  const {api,fetcher}=setup();
  await userEvent.setup().click(await screen.findByRole('button',{name:'Deny'}));
  await vi.waitFor(()=>expect(fetcher.mock.calls.some(c=>c[1]?.method==='POST')).toBe(true));
  expect(api.mcpGrantClient).not.toHaveBeenCalled();
  expect(JSON.parse(String(fetcher.mock.calls.find(c=>c[1]?.method==='POST')![1]!.body))).toEqual({decision:'deny'});
});
