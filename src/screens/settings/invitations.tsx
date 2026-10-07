import { useState, type FormEvent } from 'react';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { ErrorNotice, LoadState, useCommand, useLoad } from '../../ui/async.tsx';

export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function Invitations() {
  const { t } = useI18n();
  const { space } = useWorkspace();
  return <section className="cr-settings-section">
    <h2>{t('invite.title')}</h2>
    {space.role === 'owner' ? <OwnerInvitations key={space.id} /> : <p className="cr-helper">{t('invite.ownerOnly')}</p>}
  </section>;
}

function OwnerInvitations() {
  const { t, date } = useI18n();
  const { api, space } = useWorkspace();
  const invitations = useLoad(() => api.spaceInvitations(space.id), [api, space.id]);
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(newInviteToken);
  const [link, setLink] = useState<{ url: string; expiresAt: string; invitationId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const command = useCommand((requestId, _: null) => api.createSpaceInvitation({ spaceId: space.id, requestId, email: email.trim(), token }));
  const revoke = useCommand((_, invitationId: string) => api.revokeSpaceInvitation(space.id, invitationId));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await command.submit(null);
    if (!result) return;
    const url = new URL('/', window.location.origin);
    url.hash = `/invite/${token}`;
    setLink({ url: url.href, ...result });
    setCopied(false);
    setCopyFailed(false);
    setToken(newInviteToken());
    invitations.reload();
  }
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setCopyFailed(false);
    } catch { setCopyFailed(true); }
  }
  return <div className="cr-stack cr-invite-controls">
    <p className="cr-helper">{t('invite.help')}</p>
    <form className="cr-stack" onSubmit={event => void submit(event)}>
      <label className="cr-field"><span className="cr-label">{t('invite.email')}</span><input name="recipient-email" type="email" autoComplete="email" dir="ltr" required maxLength={254} disabled={command.pending} value={email} onChange={event => {
        setEmail(event.target.value);
        command.resetRequest();
        setToken(newInviteToken());
        setLink(null);
        setCopied(false);
        setCopyFailed(false);
      }} /></label>
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <button type="submit" className="cr-button cr-button--primary" disabled={command.pending}>{t('invite.create')}</button>
    </form>
    {link ? <div className="cr-stack">
      <p className="cr-helper">{t('invite.send', { date: date(link.expiresAt.slice(0, 10)) })}</p>
      <label className="cr-field"><span className="cr-label">{t('invite.link')}</span><input name="invite-link" dir="ltr" type="text" readOnly value={link.url} onFocus={event => event.target.select()} /></label>
      <button type="button" className="cr-button" onClick={() => void copy()}>{t('invite.copy')}</button>
      {copied ? <p role="status" className="cr-helper">{t('invite.copied')}</p> : null}
      {copyFailed ? <p role="status" className="cr-helper">{t('invite.copyFailed')}</p> : null}
    </div> : null}
    {revoke.error ? <ErrorNotice error={revoke.error} /> : null}
    <LoadState loaded={invitations}>{list => list.length ? <ul className="cr-invitations">{list.map(invitation => <li key={invitation.invitationId}>
      <div><bdi>{invitation.email}</bdi><p className="cr-helper">{t('invite.expires', { date: date(invitation.expiresAt.slice(0, 10)) })}</p></div>
      <button type="button" className="cr-button cr-button--sm" disabled={revoke.pending} onClick={() => void revoke.submit(invitation.invitationId).then(result => {
        if (result) { if (link?.invitationId === invitation.invitationId) setLink(null); invitations.reload(); }
      })}>{t('invite.revoke')}</button>
    </li>)}</ul> : <p className="cr-helper">{t('invite.empty')}</p>}</LoadState>
  </div>;
}
